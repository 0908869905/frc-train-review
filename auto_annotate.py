"""
Gemini 自動標註工具 — 用 Gemini Vision 自動標註 FRC 機器人訓練資料

用法:
    # 從影片提取幀 + Gemini 標註 + 互動審核
    python auto_annotate.py match_video.mp4

    # 標註已提取的圖片目錄
    python auto_annotate.py --images datasets/custom_frames/

    # 只審核已有標註（跳過提取和標註）
    python auto_annotate.py --review datasets/annotated/

    # 自訂參數
    python auto_annotate.py match_video.mp4 --fps 2 -o datasets/my_data

完整訓練流程:
    1. python auto_annotate.py match_video.mp4
    2. python train_robot_model.py --local-dataset datasets/annotated/data.yaml
    3. 設定 config.py: ROBOT_DETECTION_MODE = "YOLO"
    4. python main.py <video>
"""

import argparse
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# ═══════════════════════════════════════════════════════
# 常數
# ═══════════════════════════════════════════════════════

CLASS_NAMES = {0: "Red", 1: "Blue"}
CLASS_COLORS_BGR = {0: (0, 0, 255), 1: (255, 100, 0)}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

_ANNOTATE_PROMPT = """\
Detect ALL visible FRC robot bumpers in this FRC competition match image.

There are up to 6 robots on the field (3 red, 3 blue). Each robot has a colored bumper at its base. You MUST find and box EVERY visible bumper — missing bumpers is worse than false positives.

RULES:
- Bumpers are red or blue fabric-covered pool noodles attached around the base of FRC robots
- Draw the bounding box around ONLY the bumper, NOT the entire robot
- The box should tightly fit the bumper (the colored bar at the bottom of the robot)
- There are 0-6 bumpers visible (0 if obstructed or during transition screens) — look carefully for ALL of them, even small or partially occluded ones
- Partially visible bumpers at edges MUST still be boxed
- Do NOT box field elements, game pieces, or other colored objects

For each bumper, provide:
- box_2d: bounding box [y_min, x_min, y_max, x_max] normalized 0-1000
- alliance: "red" or "blue" based on bumper color

Return as JSON array.
"""


# ═══════════════════════════════════════════════════════
# Gemini API
# ═══════════════════════════════════════════════════════

def _load_api_key() -> str:
    """Read Gemini API key from environment or .env file."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        env_file = Path(__file__).parent / ".env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip()
                elif not key and line.startswith("GOOGLE_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        print("[ERROR] Gemini API Key not found.")
        print("  Set GEMINI_API_KEY env var or add to .env in project root.")
        sys.exit(1)
    return key


def _init_gemini(timeout: int = 30):
    """Initialize and return Gemini client."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("[ERROR] google-genai not installed.")
        print("  pip install google-genai")
        sys.exit(1)
    return genai.Client(
        api_key=_load_api_key(),
        http_options=types.HttpOptions(timeout=timeout * 1000),
    )


def _annotate_one(client, model: str, img_path: str,
                  max_size: int = 1280) -> list[dict]:
    """Send one image to Gemini, return detections using native box_2d.

    Uses unstructured response with native Gemini box_2d format
    [y_min, x_min, y_max, x_max] in 1000-based coordinates.

    Returns:
        [{"box_2d": [y1,x1,y2,x2], "alliance": "red"|"blue"}, ...]
    """
    import re
    from PIL import Image as PILImage
    from google.genai import types

    pil = PILImage.open(img_path).convert("RGB")

    resp = client.models.generate_content(
        model=model,
        contents=[pil, _ANNOTATE_PROMPT],
        config=types.GenerateContentConfig(
            temperature=0.1,
        ),
    )

    # Parse unstructured response — extract JSON array
    text = resp.text or ""
    m = re.search(r'\[.*\]', text, re.DOTALL)
    if not m:
        return []

    try:
        dets = json.loads(m.group())
    except json.JSONDecodeError:
        # Try fixing common issues: trailing commas
        fixed = re.sub(r',\s*([}\]])', r'\1', m.group())
        try:
            dets = json.loads(fixed)
        except json.JSONDecodeError:
            return []

    return dets if isinstance(dets, list) else []


# ═══════════════════════════════════════════════════════
# YOLO Label I/O
# ═══════════════════════════════════════════════════════

# Exclusion zones: (cx, cy, tolerance_x, tolerance_y) in normalized coords.
# These are fixed field elements that Gemini frequently misidentifies as bumpers.
_EXCLUSION_ZONES = [
    (0.140, 0.490, 0.06, 0.10),  # left field structure
    (0.874, 0.490, 0.06, 0.10),  # right field structure
]


def _in_exclusion_zone(cx: float, cy: float) -> bool:
    """Check if a detection center falls within an exclusion zone."""
    for zx, zy, tx, ty in _EXCLUSION_ZONES:
        if abs(cx - zx) < tx and abs(cy - zy) < ty:
            return True
    return False


def _to_yolo(dets: list[dict], w: int, h: int) -> list[tuple]:
    """Convert Gemini native box_2d detections -> YOLO format.

    Gemini box_2d format: [y_min, x_min, y_max, x_max] in 1000-based coords.
    YOLO format: (cls, cx, cy, bw, bh) normalized 0-1.
    """
    out = []
    for d in dets:
        b = d.get("box_2d", [])
        if len(b) != 4:
            continue
        # Convert 1000-based coords to pixel coords
        y1 = b[0] / 1000 * h
        x1 = b[1] / 1000 * w
        y2 = b[2] / 1000 * h
        x2 = b[3] / 1000 * w
        # Clamp to image bounds
        x1, x2 = max(0, min(x1, w)), max(0, min(x2, w))
        y1, y2 = max(0, min(y1, h)), max(0, min(y2, h))
        bw, bh_ = x2 - x1, y2 - y1
        if bw < 5 or bh_ < 5:
            continue
        cx_n, cy_n = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
        # Skip known false positive zones (field structures)
        if _in_exclusion_zone(cx_n, cy_n):
            continue
        cls = 0 if d.get("alliance", "").lower() == "red" else 1
        out.append((cls, cx_n, cy_n, bw / w, bh_ / h))
    return out


def _save_labels(path: Path, labels: list[tuple]):
    """Save YOLO-format labels to .txt file."""
    with open(path, "w") as f:
        for c, cx, cy, bw, bh in labels:
            f.write(f"{c} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")


def _load_labels(path: Path) -> list[tuple]:
    """Load YOLO-format labels from .txt file."""
    if not path.is_file():
        return []
    out = []
    for line in path.read_text().strip().splitlines():
        p = line.split()
        if len(p) == 5:
            out.append((int(p[0]),
                        float(p[1]), float(p[2]),
                        float(p[3]), float(p[4])))
    return out


# ═══════════════════════════════════════════════════════
# Frame Extraction
# ═══════════════════════════════════════════════════════

def _extract(video: str, out_dir: Path,
             fps: float = 1.0, start: float = 0,
             end: float | None = None) -> list[Path]:
    """Extract frames from video at specified FPS."""
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open: {video}")
        return []

    vfps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    dur = total / vfps
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    end = end or dur

    interval = max(1, int(vfps / fps))
    sf = int(start * vfps)
    ef = min(int(end * vfps), total)

    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Video: {video}  ({w}x{h}, {vfps:.0f}fps, {dur:.0f}s)")
    print(f"  Range: {start:.0f}s ~ {end:.0f}s, extract {fps} fps")

    cap.set(cv2.CAP_PROP_POS_FRAMES, sf)
    saved = []
    fi = sf

    while fi < ef:
        ret, frame = cap.read()
        if not ret:
            break
        if (fi - sf) % interval == 0:
            ts = fi / vfps
            name = f"frame_{fi:06d}_t{ts:.1f}s.jpg"
            p = out_dir / name
            cv2.imwrite(str(p), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
            saved.append(p)
        fi += 1

    cap.release()
    print(f"  Extracted {len(saved)} frames -> {out_dir}")
    return saved


# ═══════════════════════════════════════════════════════
# Annotation
# ═══════════════════════════════════════════════════════

def _annotate_all(img_dir: Path, lbl_dir: Path,
                  model: str, max_size: int = 1280,
                  preview: bool = False):
    """Annotate all images with Gemini API. Shows progress in console."""
    imgs = sorted(p for p in img_dir.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS)
    if not imgs:
        print(f"[ERROR] No images in {img_dir}")
        return

    lbl_dir.mkdir(parents=True, exist_ok=True)

    done = {p.stem for p in lbl_dir.iterdir() if p.suffix == ".txt"}
    todo = [p for p in imgs if p.stem not in done]

    print(f"\nImages: {len(imgs)}, already done: {len(done)}, "
          f"to annotate: {len(todo)}")
    if not todo:
        print("All done! Use --review to review annotations.")
        return

    client = _init_gemini()
    print(f"Model: {model}\n")

    stats = {"ok": 0, "empty": 0, "err": 0, "red": 0, "blue": 0}
    t0 = time.time()

    for i, ip in enumerate(todo):
        img = cv2.imread(str(ip))
        if img is None:
            print(f"  [SKIP] Cannot read: {ip.name}")
            stats["err"] += 1
            continue
        ih, iw = img.shape[:2]

        # Gemini API call with retry on rate limit
        dets = None
        for attempt in range(3):
            try:
                dets = _annotate_one(client, model, str(ip), max_size)
                break
            except Exception as e:
                msg = str(e)
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    wait = 15 * (attempt + 1)
                    print(f"  [RATE LIMIT] Retry in {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"  [ERROR] {ip.name}: {e}")
                    stats["err"] += 1
                    break

        if dets is None:
            # All retries failed, save empty label
            _save_labels(lbl_dir / f"{ip.stem}.txt", [])
            stats["empty"] += 1
            continue

        labels = _to_yolo(dets, iw, ih)
        _save_labels(lbl_dir / f"{ip.stem}.txt", labels)

        nr = sum(1 for l in labels if l[0] == 0)
        nb = sum(1 for l in labels if l[0] == 1)
        stats["red"] += nr
        stats["blue"] += nb
        if labels:
            stats["ok"] += 1
        else:
            stats["empty"] += 1

        elapsed = time.time() - t0
        speed = (i + 1) / elapsed if elapsed > 0 else 0
        print(f"  [{i+1}/{len(todo)}] {ip.name}: "
              f"Red={nr} Blue={nb} ({speed:.1f} img/s)")

        # Preview: show annotated frame briefly
        if preview and labels:
            disp = _draw_boxes(img, labels)
            disp_small, _ = _fit_display(disp)
            cv2.imshow("Annotating...", disp_small)
            cv2.waitKey(800)

        time.sleep(0.5)  # Rate limit buffer

    if preview:
        cv2.destroyAllWindows()

    el = time.time() - t0
    print(f"\nAnnotation done in {el:.0f}s")
    print(f"  Annotated: {stats['ok']}, Empty: {stats['empty']}, "
          f"Errors: {stats['err']}")
    print(f"  Total boxes: Red={stats['red']}, Blue={stats['blue']}")


# ═══════════════════════════════════════════════════════
# Drawing
# ═══════════════════════════════════════════════════════

def _draw_boxes(img: np.ndarray, labels: list[tuple],
                selected: int = -1) -> np.ndarray:
    """Draw numbered bounding boxes on image copy."""
    out = img.copy()
    h, w = out.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX

    for i, (cls, cx, cy, bw, bh) in enumerate(labels):
        x1 = int((cx - bw / 2) * w)
        y1 = int((cy - bh / 2) * h)
        x2 = int((cx + bw / 2) * w)
        y2 = int((cy + bh / 2) * h)

        color = CLASS_COLORS_BGR.get(cls, (0, 255, 0))
        thickness = 4 if i == selected else 3

        # Yellow highlight for selected box
        if i == selected:
            cv2.rectangle(out, (x1 - 3, y1 - 3),
                          (x2 + 3, y2 + 3), (0, 255, 255), 3)

        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        # Number + class label
        name = CLASS_NAMES.get(cls, "?")
        label = f"{i + 1} {name}"
        fs = max(0.6, min(1.2, w / 1500))
        (tw, th), _ = cv2.getTextSize(label, font, fs, 2)
        cv2.rectangle(out, (x1, y1 - th - 14),
                      (x1 + tw + 14, y1), color, -1)
        cv2.putText(out, label, (x1 + 7, y1 - 7),
                    font, fs, (255, 255, 255), 2)

    return out


def _fit_display(img: np.ndarray,
                 max_w: int = 1280, max_h: int = 720):
    """Resize image to fit display. Returns (resized, scale)."""
    h, w = img.shape[:2]
    scale = min(max_w / w, max_h / h, 1.0)
    if scale < 1.0:
        return cv2.resize(img, (int(w * scale), int(h * scale))), scale
    return img.copy(), 1.0


# ═══════════════════════════════════════════════════════
# Review Viewer
# ═══════════════════════════════════════════════════════

def _review(img_dir: Path, lbl_dir: Path):
    """Interactive annotation reviewer.

    Controls:
        Left/Right  Navigate images
        1-9         Delete individual box by number
        X           Delete ALL boxes for current image
        Z           Undo last delete
        Q / Esc     Finish review
    """
    imgs = sorted(p for p in img_dir.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS)
    if not imgs:
        print("[ERROR] No images to review.")
        return

    # Filter to annotated images only
    annotated = [p for p in imgs
                 if (lbl_dir / f"{p.stem}.txt").is_file()]
    if not annotated:
        print("[INFO] No annotations found. Run annotation first.")
        return

    total = len(annotated)
    idx = 0
    undo_stack: list[tuple[str, list[tuple]]] = []
    n_deleted_boxes = 0
    n_deleted_frames = 0

    print(f"\n{'=' * 50}")
    print(f"  Annotation Review  ({total} images)")
    print(f"{'=' * 50}")
    print(f"  Left/Right   Navigate")
    print(f"  1-9          Delete individual box")
    print(f"  X            Delete ALL boxes")
    print(f"  Z            Undo last delete")
    print(f"  Q / Esc      Finish review")
    print()

    win = "Annotation Review"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)

    while True:
        ip = annotated[idx]
        img = cv2.imread(str(ip))
        if img is None:
            idx = (idx + 1) % total
            continue
        ih, iw = img.shape[:2]

        labels = _load_labels(lbl_dir / f"{ip.stem}.txt")
        nr = sum(1 for l in labels if l[0] == 0)
        nb = sum(1 for l in labels if l[0] == 1)

        # Draw boxes with numbers
        disp = _draw_boxes(img, labels)

        # Top status bar
        bar_h = max(50, int(ih * 0.035))
        cv2.rectangle(disp, (0, 0), (iw, bar_h), (0, 0, 0), -1)
        status = (f"[{idx + 1}/{total}] {ip.name}  |  "
                  f"Red:{nr}  Blue:{nb}  Total:{len(labels)}")
        fs = max(0.5, min(1.0, iw / 1800))
        cv2.putText(disp, status, (10, bar_h - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 255, 0), 2)

        if not labels:
            # Show "Empty" indicator in center
            msg = "No detections"
            (tw, th), _ = cv2.getTextSize(
                msg, cv2.FONT_HERSHEY_SIMPLEX, 1.5, 3)
            cx = (iw - tw) // 2
            cy = ih // 2
            cv2.putText(disp, msg, (cx, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.5,
                        (0, 200, 255), 3)

        # Bottom control bar
        ctrl_h = max(40, int(ih * 0.03))
        cv2.rectangle(disp, (0, ih - ctrl_h), (iw, ih), (0, 0, 0), -1)
        ctrl = (f"<- -> Nav | 1-9 Del box | X Del all | Z Undo | "
                f"Q Done  [Del: {n_deleted_boxes} boxes, "
                f"{n_deleted_frames} frames]")
        fs2 = max(0.4, min(0.7, iw / 2200))
        cv2.putText(disp, ctrl, (10, ih - int(ctrl_h * 0.3)),
                    cv2.FONT_HERSHEY_SIMPLEX, fs2, (180, 180, 180), 1)

        # Resize for display
        disp_small, _ = _fit_display(disp)
        cv2.imshow(win, disp_small)

        key = cv2.waitKeyEx(0)

        # ── Navigation ──
        if key in (2424832, 65361):       # Left arrow
            idx = (idx - 1) % total
        elif key in (2555904, 65363):     # Right arrow
            idx = (idx + 1) % total

        # ── Delete individual box (1-9) ──
        elif ord('1') <= (key & 0xFF) <= ord('9'):
            bi = (key & 0xFF) - ord('1')  # 0-based index
            if bi < len(labels):
                undo_stack.append((ip.stem, list(labels)))
                removed = labels[bi]
                labels.pop(bi)
                _save_labels(lbl_dir / f"{ip.stem}.txt", labels)
                n_deleted_boxes += 1
                rname = CLASS_NAMES.get(removed[0], "?")
                print(f"  [DEL] {ip.name} box#{bi + 1} ({rname})")

        # ── Delete all boxes ──
        elif (key & 0xFF) in (ord('x'), ord('X')):
            if labels:
                undo_stack.append((ip.stem, list(labels)))
                n_deleted_boxes += len(labels)
                n_deleted_frames += 1
                _save_labels(lbl_dir / f"{ip.stem}.txt", [])
                print(f"  [DEL ALL] {ip.name} ({len(labels)} boxes)")

        # ── Undo ──
        elif (key & 0xFF) in (ord('z'), ord('Z')):
            if undo_stack:
                stem, old_labels = undo_stack.pop()
                cur = _load_labels(lbl_dir / f"{stem}.txt")
                diff = len(old_labels) - len(cur)
                n_deleted_boxes = max(0, n_deleted_boxes - diff)
                if not cur and old_labels:
                    n_deleted_frames = max(0, n_deleted_frames - 1)
                _save_labels(lbl_dir / f"{stem}.txt", old_labels)
                # Navigate to the undone image
                for i, p in enumerate(annotated):
                    if p.stem == stem:
                        idx = i
                        break
                print(f"  [UNDO] {stem} ({len(old_labels)} boxes restored)")

        # ── Quit ──
        elif (key & 0xFF) in (27, ord('q'), ord('Q')):
            break

    cv2.destroyAllWindows()
    print(f"\nReview done: deleted {n_deleted_boxes} boxes, "
          f"{n_deleted_frames} full frames")


# ═══════════════════════════════════════════════════════
# Dataset Export
# ═══════════════════════════════════════════════════════

def _export(img_dir: Path, lbl_dir: Path,
            out_dir: Path, val_ratio: float = 0.2) -> Path | None:
    """Split into train/val and generate data.yaml for YOLO training."""
    imgs = sorted(p for p in img_dir.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS)

    # Only export images with non-empty labels
    good = []
    for ip in imgs:
        lp = lbl_dir / f"{ip.stem}.txt"
        if lp.is_file():
            labels = _load_labels(lp)
            if labels:
                good.append(ip)

    if not good:
        print("[ERROR] No annotated images to export.")
        return None

    # Count total boxes
    total_red = 0
    total_blue = 0
    for ip in good:
        labels = _load_labels(lbl_dir / f"{ip.stem}.txt")
        total_red += sum(1 for l in labels if l[0] == 0)
        total_blue += sum(1 for l in labels if l[0] == 1)

    random.shuffle(good)
    nv = max(1, int(len(good) * val_ratio))
    val_imgs = good[:nv]
    train_imgs = good[nv:]

    # Create directory structure
    for split in ("train", "val"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    # Copy files
    for split, img_list in [("train", train_imgs), ("val", val_imgs)]:
        for ip in img_list:
            lp = lbl_dir / f"{ip.stem}.txt"
            shutil.copy2(ip, out_dir / "images" / split / ip.name)
            shutil.copy2(lp, out_dir / "labels" / split / lp.name)

    # Generate data.yaml
    yaml_path = out_dir / "data.yaml"
    yaml_path.write_text(
        f"path: {out_dir.resolve()}\n"
        f"train: images/train\n"
        f"val: images/val\n\n"
        f"names:\n"
        f"  0: Red\n"
        f"  1: Blue\n",
        encoding="utf-8",
    )

    print(f"\nDataset exported -> {out_dir}")
    print(f"  Train: {len(train_imgs)} images")
    print(f"  Val: {nv} images")
    print(f"  Total boxes: Red={total_red}, Blue={total_blue}")
    print(f"  data.yaml: {yaml_path}")

    return yaml_path


# ═══════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Gemini auto-annotate FRC robot training data")

    parser.add_argument(
        "video", nargs="?", default=None,
        help="Video file to extract + annotate")
    parser.add_argument(
        "--images", type=str,
        help="Image directory to annotate (skip extraction)")
    parser.add_argument(
        "--review", type=str,
        help="Review existing annotations only (skip annotation)")
    parser.add_argument(
        "-o", "--output", default="datasets/annotated",
        help="Output directory (default: datasets/annotated)")
    parser.add_argument(
        "--fps", type=float, default=1.0,
        help="Frames per second to extract (default: 1)")
    parser.add_argument(
        "--start", type=float, default=0,
        help="Start time in seconds")
    parser.add_argument(
        "--end", type=float, default=None,
        help="End time in seconds")
    parser.add_argument(
        "--model", type=str, default=None,
        help="Gemini model name (default: from config.py)")
    parser.add_argument(
        "--max-size", type=int, default=1280,
        help="Max image dimension sent to API (default: 1280)")
    parser.add_argument(
        "--preview", action="store_true",
        help="Show preview during annotation")
    parser.add_argument(
        "--skip-review", action="store_true",
        help="Skip interactive review")
    parser.add_argument(
        "--val-ratio", type=float, default=0.2,
        help="Validation split ratio (default: 0.2)")

    args = parser.parse_args()

    if not args.video and not args.images and not args.review:
        parser.error("Provide a video file, --images dir, or --review dir")

    out = Path(args.output)

    # Default model from config.py
    model = args.model
    if not model:
        try:
            from config import GEMINI_MODEL
            model = GEMINI_MODEL
        except ImportError:
            model = "gemini-2.5-flash"

    # ── Review only mode ──
    if args.review:
        rdir = Path(args.review)
        r_img = rdir / "images_raw"
        r_lbl = rdir / "labels_raw"
        # Fallback: maybe the review dir IS the images dir
        if not r_img.is_dir():
            # Try reading meta.json
            meta = rdir / "meta.json"
            if meta.is_file():
                m = json.loads(meta.read_text(encoding="utf-8"))
                r_img = Path(m["image_dir"])
                r_lbl = Path(m["label_dir"])
            else:
                print(f"[ERROR] Cannot find images in {rdir}")
                print(f"  Expected: {r_img}")
                sys.exit(1)

        _review(r_img, r_lbl)

        print()
        print("=" * 50)
        print("  Export Dataset")
        print("=" * 50)
        _export(r_img, r_lbl, rdir, args.val_ratio)
        return

    # ── Determine image and label directories ──
    if args.video:
        img_dir = out / "images_raw"
        lbl_dir = out / "labels_raw"
    else:
        img_dir = Path(args.images)
        lbl_dir = out / "labels_raw"

    # Save metadata for --review later
    out.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps({
        "image_dir": str(img_dir.resolve()),
        "label_dir": str(lbl_dir.resolve()),
    }, ensure_ascii=False), encoding="utf-8")

    # ── Phase 1: Extract frames ──
    if args.video:
        print("=" * 50)
        print("  Phase 1: Extract Frames")
        print("=" * 50)
        _extract(args.video, img_dir,
                 fps=args.fps, start=args.start, end=args.end)
    else:
        if not img_dir.is_dir():
            print(f"[ERROR] Directory not found: {img_dir}")
            sys.exit(1)
        n = sum(1 for p in img_dir.iterdir()
                if p.suffix.lower() in IMAGE_EXTS)
        print(f"Using existing images: {img_dir} ({n} files)")

    # ── Phase 2: Annotate ──
    print()
    print("=" * 50)
    print("  Phase 2: Gemini Annotation")
    print("=" * 50)
    _annotate_all(img_dir, lbl_dir, model, args.max_size,
                  preview=args.preview)

    # ── Phase 3: Review ──
    if not args.skip_review:
        print()
        print("=" * 50)
        print("  Phase 3: Review Annotations")
        print("=" * 50)
        _review(img_dir, lbl_dir)

    # ── Phase 4: Export ──
    print()
    print("=" * 50)
    print("  Phase 4: Export Dataset")
    print("=" * 50)
    yaml = _export(img_dir, lbl_dir, out, args.val_ratio)

    if yaml:
        print()
        print("=" * 50)
        print("  Done! Next steps:")
        print("=" * 50)
        print(f"  1. Train YOLO model:")
        print(f"     python train_robot_model.py "
              f"--local-dataset {yaml}")
        print()
        print(f"  2. Set config.py:")
        print(f"     ROBOT_DETECTION_MODE = \"YOLO\"")
        print()
        print(f"  3. Run analyzer:")
        print(f"     python main.py <video>")
        print("=" * 50)


if __name__ == "__main__":
    main()
