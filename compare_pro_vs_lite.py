"""
Gemini 3.1 Pro vs Flash Lite Annotation Compare

One-off offline experiment: run both models on 6 high-density FRC 2026
REBUILT frames, produce side-by-side PNGs + summary table.

Usage:
    python compare_pro_vs_lite.py

Output:
    datasets/_compare_pro_vs_lite/
      ├── manifest.json
      ├── images/*.jpg                     (6 source images)
      ├── labels_pro/*.txt                 (YOLO labels from Pro)
      ├── labels_lite/*.txt                (YOLO labels from Lite)
      └── compare_<stem>.png × 6
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from google.genai import types

from auto_pipeline import (
    CLASSES,
    CLASS_COLORS_BGR,
    CLASS_IDX,
    LABELS_DIR,
    PROCESSED,
    _PROMPT,
    _RESPONSE_SCHEMA,
    build_gemini_client,
    prep_image_bytes,
    save_yolo_labels,
    to_yolo,
)

# ═════════════════════════════════════════════════════════════
# Constants
# ═════════════════════════════════════════════════════════════

PROJECT_ROOT = Path(__file__).parent.resolve()
OUT_DIR = PROJECT_ROOT / "datasets" / "_compare_pro_vs_lite"
OUT_IMAGES = OUT_DIR / "images"
OUT_LABELS_PRO = OUT_DIR / "labels_pro"
OUT_LABELS_LITE = OUT_DIR / "labels_lite"
MANIFEST_PATH = OUT_DIR / "manifest.json"

MODEL_PRO = "gemini-3.1-pro-preview"
MODEL_LITE = "gemini-3.1-flash-lite-preview"

TARGET_N = 6                              # 取幾張
PRIMARY_FILTER = (3, 10)                  # (bumper_min, fuel_min)
FALLBACK_FILTER = (2, 5)
CONCURRENCY = 12                          # 6 imgs × 2 models


def count_classes(label_path: Path) -> tuple[int, int, int]:
    """Parse YOLO label file, return (n_red, n_blue, n_fuel)."""
    if not label_path.is_file():
        return (0, 0, 0)
    nr = nb = nf = 0
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        try:
            cls = int(parts[0])
        except ValueError:
            continue
        if cls == CLASS_IDX["red_robot"]:
            nr += 1
        elif cls == CLASS_IDX["blue_robot"]:
            nb += 1
        elif cls == CLASS_IDX["fuel"]:
            nf += 1
    return (nr, nb, nf)


def find_image_for_stem(stem: str) -> Path | None:
    """Locate the source jpg in processed/{owner}/images/*.jpg."""
    matches = list(PROCESSED.glob(f"*/images/{stem}.jpg"))
    return matches[0] if matches else None


def pick_images() -> list[dict]:
    """Scan existing Lite labels, filter by density, copy top N source images
    into OUT_IMAGES/, return list of dicts with metadata for manifest.

    Returns:
        [{"stem": str, "source": str, "red": int, "blue": int, "fuel": int,
          "total_bumper": int}, ...] length TARGET_N
    """
    if not LABELS_DIR.is_dir():
        print(f"[ERROR] {LABELS_DIR} 不存在 — 先跑 auto_pipeline annotate")
        sys.exit(1)

    # Scan every label file
    print(f"掃描 {LABELS_DIR} ...")
    all_entries: list[dict] = []
    for lbl in LABELS_DIR.glob("*.txt"):
        nr, nb, nf = count_classes(lbl)
        all_entries.append({
            "stem": lbl.stem,
            "red": nr, "blue": nb, "fuel": nf,
            "total_bumper": nr + nb,
        })
    print(f"  共 {len(all_entries)} 個 label 檔")

    def apply_filter(bumper_min: int, fuel_min: int) -> list[dict]:
        return [e for e in all_entries
                if e["total_bumper"] >= bumper_min and e["fuel"] >= fuel_min]

    # Primary filter
    bm, fm = PRIMARY_FILTER
    matched = apply_filter(bm, fm)
    print(f"  主門檻 bumper>={bm} & fuel>={fm}: 命中 {len(matched)} 張")

    if len(matched) < TARGET_N:
        bm, fm = FALLBACK_FILTER
        matched = apply_filter(bm, fm)
        print(f"  Fallback 門檻 bumper>={bm} & fuel>={fm}: 命中 {len(matched)} 張")

    if len(matched) < TARGET_N:
        print(f"[ERROR] 連 fallback 都不到 {TARGET_N} 張。分佈直方圖：")
        bumper_hist = {}
        fuel_hist = {}
        for e in all_entries:
            bumper_hist[e["total_bumper"]] = bumper_hist.get(e["total_bumper"], 0) + 1
            fuel_hist[e["fuel"]] = fuel_hist.get(e["fuel"], 0) + 1
        print(f"  bumper 數量分佈: {sorted(bumper_hist.items())[:10]}")
        print(f"  fuel 數量分佈: {sorted(fuel_hist.items())[:10]}")
        print("  請手動下修門檻後重跑")
        sys.exit(1)

    # Sort by fuel desc, then total_bumper desc (tie-break), take top N
    matched.sort(key=lambda e: (e["fuel"], e["total_bumper"]), reverse=True)
    picked = matched[:TARGET_N]

    # Copy source images + attach source path
    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    result = []
    for e in picked:
        src = find_image_for_stem(e["stem"])
        if src is None:
            print(f"  [WARN] {e['stem']} 找不到 source image，跳過")
            continue
        dst = OUT_IMAGES / f"{e['stem']}.jpg"
        if not dst.exists():
            shutil.copy2(src, dst)
        result.append({**e, "source": str(src)})

    if len(result) < TARGET_N:
        print(f"[ERROR] 只成功 copy {len(result)} 張，少於 {TARGET_N}，中止")
        sys.exit(1)

    print(f"已挑選 {len(result)} 張：")
    for e in result:
        print(f"  {e['stem']}: red={e['red']} blue={e['blue']} fuel={e['fuel']}")
    return result


def load_yolo_labels(path: Path) -> list[tuple[int, float, float, float, float]]:
    """Parse YOLO label file, return list of (cls, cx, cy, w, h)."""
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        try:
            out.append((
                int(parts[0]),
                float(parts[1]), float(parts[2]),
                float(parts[3]), float(parts[4]),
            ))
        except ValueError:
            continue
    return out


def draw_boxes_on_image(img: np.ndarray, labels: list[tuple]) -> np.ndarray:
    """Draw YOLO bboxes with class labels. Returns new image copy."""
    out = img.copy()
    h, w = out.shape[:2]
    thickness = max(2, int(min(h, w) / 400))
    font_scale = max(0.5, min(h, w) / 1800)
    for cls, cx, cy, bw, bh in labels:
        x1 = int((cx - bw / 2) * w)
        y1 = int((cy - bh / 2) * h)
        x2 = int((cx + bw / 2) * w)
        y2 = int((cy + bh / 2) * h)
        color = CLASS_COLORS_BGR.get(cls, (0, 255, 0))
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)
        label_text = CLASSES[cls] if 0 <= cls < len(CLASSES) else "?"
        cv2.putText(
            out, label_text, (x1, max(y1 - 4, 14)),
            cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness,
        )
    return out


def add_header(img: np.ndarray, title: str, counts: tuple[int, int, int]) -> np.ndarray:
    """Overlay a black header bar with title + class counts at top."""
    h, w = img.shape[:2]
    bar_h = max(60, int(h * 0.05))
    out = img.copy()
    cv2.rectangle(out, (0, 0), (w, bar_h), (0, 0, 0), -1)
    nr, nb, nf = counts
    text = f"{title}   Red:{nr}  Blue:{nb}  Fuel:{nf}  Total:{nr + nb + nf}"
    fs = max(0.7, w / 1600)
    cv2.putText(
        out, text, (12, int(bar_h * 0.7)),
        cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 2,
    )
    return out


def make_compare_png(stem: str, results_by_key: dict) -> Path | None:
    """Build side-by-side compare PNG for one stem. Returns output path."""
    img_path = OUT_IMAGES / f"{stem}.jpg"
    raw = cv2.imdecode(np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if raw is None:
        print(f"  [WARN] 無法讀取 {img_path}")
        return None

    pro_lbl = load_yolo_labels(OUT_LABELS_PRO / f"{stem}.txt")
    lite_lbl = load_yolo_labels(OUT_LABELS_LITE / f"{stem}.txt")

    def panel(labels, title: str, result: dict) -> np.ndarray:
        if result.get("status", "") != "done":
            panel_img = raw.copy()
            h, w = panel_img.shape[:2]
            cv2.rectangle(panel_img, (0, 0), (w, h), (0, 0, 0), -1)
            cv2.putText(
                panel_img, f"{title}: API FAILED", (30, h // 2),
                cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3,
            )
            return panel_img
        drawn = draw_boxes_on_image(raw, labels)
        counts = (result["n_red"], result["n_blue"], result["n_fuel"])
        return add_header(drawn, title, counts)

    pro_result = results_by_key.get((stem, MODEL_PRO), {"status": "missing"})
    lite_result = results_by_key.get((stem, MODEL_LITE), {"status": "missing"})

    left = panel(pro_lbl, "GEMINI 3.1 PRO", pro_result)
    right = panel(lite_lbl, "GEMINI 3.1 FLASH LITE", lite_result)

    h = left.shape[0]
    divider = np.zeros((h, 8, 3), dtype=np.uint8)
    combined = cv2.hconcat([left, divider, right])

    out_path = OUT_DIR / f"compare_{stem}.png"
    ok, buf = cv2.imencode(".png", combined)
    if not ok:
        print(f"  [ERROR] PNG encode failed for {stem}")
        return None
    out_path.write_bytes(buf.tobytes())
    return out_path


async def annotate_one_to_file(
    client,
    model: str,
    img_path: Path,
    out_label_dir: Path,
    sem: asyncio.Semaphore,
) -> dict:
    """Annotate one image with given model, save YOLO labels to out_label_dir.

    Returns {"stem": str, "model": str, "status": "done"|"error:...",
             "n_red": int, "n_blue": int, "n_fuel": int}.
    """
    stem = img_path.stem
    async with sem:
        try:
            jpeg_bytes, _ow, _oh = await asyncio.to_thread(prep_image_bytes, img_path)
            last_err = None
            for attempt in range(4):
                try:
                    img_part = types.Part.from_bytes(
                        data=jpeg_bytes, mime_type="image/jpeg")
                    resp = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model,
                        contents=[img_part, _PROMPT],
                        config=types.GenerateContentConfig(
                            temperature=0.1,
                            response_mime_type="application/json",
                            response_schema=_RESPONSE_SCHEMA,
                        ),
                    )
                    text = resp.text or "[]"
                    try:
                        data = json.loads(text)
                    except json.JSONDecodeError:
                        import re
                        m = re.search(r"\[.*\]", text, re.DOTALL)
                        data = json.loads(m.group()) if m else []
                    if not isinstance(data, list):
                        data = []
                    labels = to_yolo(data)
                    out_path = out_label_dir / f"{stem}.txt"
                    save_yolo_labels(out_path, labels)
                    nr = sum(1 for l in labels if l[0] == CLASS_IDX["red_robot"])
                    nb = sum(1 for l in labels if l[0] == CLASS_IDX["blue_robot"])
                    nf = sum(1 for l in labels if l[0] == CLASS_IDX["fuel"])
                    return {"stem": stem, "model": model, "status": "done",
                            "n_red": nr, "n_blue": nb, "n_fuel": nf}
                except Exception as e:
                    last_err = e
                    msg = str(e)
                    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "503" in msg:
                        wait = 5 * (2 ** attempt)
                        print(f"  [retry] {stem}/{model} attempt {attempt+1} after {wait}s: {msg[:60]}")
                        await asyncio.sleep(wait)
                        continue
                    else:
                        break
            return {"stem": stem, "model": model,
                    "status": f"error: {last_err}",
                    "n_red": 0, "n_blue": 0, "n_fuel": 0}
        except Exception as e:
            return {"stem": stem, "model": model,
                    "status": f"error: {e}",
                    "n_red": 0, "n_blue": 0, "n_fuel": 0}


async def run_annotations(picked: list[dict]) -> list[dict]:
    """Fire 12 concurrent calls (6 imgs x 2 models), return all results."""
    OUT_LABELS_PRO.mkdir(parents=True, exist_ok=True)
    OUT_LABELS_LITE.mkdir(parents=True, exist_ok=True)
    client = build_gemini_client()
    sem = asyncio.Semaphore(CONCURRENCY)

    tasks = []
    for entry in picked:
        img = OUT_IMAGES / f"{entry['stem']}.jpg"
        tasks.append(annotate_one_to_file(client, MODEL_PRO, img, OUT_LABELS_PRO, sem))
        tasks.append(annotate_one_to_file(client, MODEL_LITE, img, OUT_LABELS_LITE, sem))

    t0 = time.time()
    results = await asyncio.gather(*tasks)
    elapsed = time.time() - t0
    print(f"  完成 {len(results)} 次 API 呼叫，耗時 {elapsed:.1f}s")

    # Print error rows inline
    for r in results:
        if r["status"] != "done":
            print(f"  [FAIL] {r['stem']} via {r['model']}: {r['status']}")
    return results


def main():
    print("Gemini 3.1 Pro vs Flash Lite compare experiment")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Stage 1: 挑圖
    print("\n[Stage 1] 挑圖")
    picked = pick_images()

    # Write manifest
    manifest = {
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "target_n": TARGET_N,
        "primary_filter": {"bumper_min": PRIMARY_FILTER[0], "fuel_min": PRIMARY_FILTER[1]},
        "fallback_filter": {"bumper_min": FALLBACK_FILTER[0], "fuel_min": FALLBACK_FILTER[1]},
        "model_pro": MODEL_PRO,
        "model_lite": MODEL_LITE,
        "picked": picked,
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"manifest -> {MANIFEST_PATH}")

    # Stage 2: 雙模型並行標註
    print("\n[Stage 2] 雙模型並行標註")
    anno_results = asyncio.run(run_annotations(picked))

    # Stage 3: 繪製對比 PNG
    print("\n[Stage 3] 繪製對比 PNG")
    results_by_key = {(r["stem"], r["model"]): r for r in anno_results}
    for entry in picked:
        out = make_compare_png(entry["stem"], results_by_key)
        if out:
            print(f"  {out.name}")


if __name__ == "__main__":
    main()
