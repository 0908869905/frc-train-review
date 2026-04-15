"""
互動式賽事裁切工具 — 為每個賽事選取主場地 ROI，提取裁切後的訓練幀

用法:
    # 為所有 2026 賽事設定裁切範圍 + 提取幀
    python crop_events.py 2026mndu 2026cosp 2026okok 2026bcvi 2026tuis

    # 只設定裁切（不提取幀）
    python crop_events.py 2026mndu --crop-only

    # 只提取幀（已有 crop.json）
    python crop_events.py 2026mndu --extract-only

    # 自訂每秒幀數
    python crop_events.py 2026mndu --fps 0.5

流程:
    1. 從每個賽事的第一部影片 30 秒處截取一幀
    2. OpenCV selectROI 互動選取主場地區域
    3. 儲存到 datasets/<event>/crop.json
    4. 批量提取所有影片的幀並裁切
"""

import argparse
import json
import glob
import os
import sys
from pathlib import Path

import cv2


def get_sample_frame(video_path: str, seek_sec: float = 30) -> tuple:
    """從影片指定秒數截取一幀。"""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None, 0, 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * seek_sec))
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None, w, h
    return frame, w, h


def interactive_crop(event_key: str, dataset_dir: Path) -> dict | None:
    """互動式選取裁切範圍。回傳 {x, y, w, h} 或 None。"""
    video_dir = dataset_dir / "videos"
    videos = sorted(glob.glob(str(video_dir / "*.mp4")))
    if not videos:
        print(f"  [ERROR] 沒有影片: {video_dir}")
        return None

    # 嘗試從第一部影片取幀
    frame = None
    for v in videos:
        frame, vw, vh = get_sample_frame(v, seek_sec=30)
        if frame is not None:
            print(f"  使用影片: {os.path.basename(v)} ({vw}x{vh})")
            break

    if frame is None:
        print(f"  [ERROR] 無法從任何影片讀取幀")
        return None

    # OpenCV selectROI
    win_name = f"SELECT ROI — {event_key} (drag to select, ENTER to confirm, C to cancel)"
    cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)

    # 縮放視窗以適應螢幕
    screen_w, screen_h = 1400, 800
    scale = min(screen_w / vw, screen_h / vh, 1.0)
    cv2.resizeWindow(win_name, int(vw * scale), int(vh * scale))

    roi = cv2.selectROI(win_name, frame, fromCenter=False, showCrosshair=True)
    cv2.destroyWindow(win_name)

    x, y, w, h = roi
    if w < 10 or h < 10:
        print(f"  [SKIP] 未選取有效範圍")
        return None

    crop = {"x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "base_w": vw, "base_h": vh}
    print(f"  裁切範圍: ({x}, {y}) {w}x{h}  (基準: {vw}x{vh})")
    return crop


def extract_cropped_frames(event_key: str, dataset_dir: Path,
                           crop: dict, fps: float = 0.333) -> int:
    """提取裁切後的幀。"""
    video_dir = dataset_dir / "videos"
    image_dir = dataset_dir / "images"
    raw_dir = dataset_dir / "images_raw"

    image_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    videos = sorted(glob.glob(str(video_dir / "*.mp4")))
    if not videos:
        print(f"  [ERROR] 沒有影片: {video_dir}")
        return 0

    # crop 基準解析度（從 crop.json 選取時的影片解析度）
    base_w = crop.get("base_w", 0)
    base_h = crop.get("base_h", 0)
    cx, cy, cw, ch = crop["x"], crop["y"], crop["w"], crop["h"]
    total_saved = 0

    for vi, vpath in enumerate(videos):
        vname = os.path.splitext(os.path.basename(vpath))[0]
        prefix = f"{vname}_"

        # 跳過已提取的
        existing = [p for p in image_dir.iterdir()
                    if p.name.startswith(prefix) and p.suffix == ".jpg"]
        if existing:
            total_saved += len(existing)
            print(f"  [{vi+1}/{len(videos)}] {vname}: "
                  f"已有 {len(existing)} 幀，跳過")
            continue

        cap = cv2.VideoCapture(vpath)
        if not cap.isOpened():
            print(f"  [{vi+1}/{len(videos)}] {vname}: 無法開啟")
            continue

        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        vfps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        interval = max(1, int(vfps / fps))

        # 按比例縮放 crop 座標到實際影片解析度
        if base_w > 0 and base_h > 0 and (vw != base_w or vh != base_h):
            sx, sy = vw / base_w, vh / base_h
            vcx = int(cx * sx)
            vcy = int(cy * sy)
            vcw = int(cw * sx)
            vch = int(ch * sy)
            print(f"  [{vi+1}/{len(videos)}] {vname}: {vw}x{vh} "
                  f"(crop 縮放 {base_w}x{base_h} → {vw}x{vh})")
        else:
            vcx, vcy, vcw, vch = cx, cy, cw, ch

        saved = 0
        fi = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if fi % interval == 0:
                # 裁切 + 統一尺寸
                cropped = frame[vcy:vcy+vch, vcx:vcx+vcw]
                if cropped.shape[1] != cw or cropped.shape[0] != ch:
                    cropped = cv2.resize(cropped, (cw, ch),
                                         interpolation=cv2.INTER_LINEAR)
                ts = fi / vfps
                name = f"{prefix}f{fi:06d}_t{ts:.1f}s.jpg"
                # 存裁切後 + 原始
                cv2.imwrite(str(image_dir / name), cropped,
                            [cv2.IMWRITE_JPEG_QUALITY, 95])
                cv2.imwrite(str(raw_dir / name), frame,
                            [cv2.IMWRITE_JPEG_QUALITY, 95])
                saved += 1
            fi += 1

        cap.release()
        total_saved += saved
        print(f"  [{vi+1}/{len(videos)}] {vname}: {saved} 幀")

    return total_saved


def main():
    parser = argparse.ArgumentParser(
        description="互動式賽事裁切 + 幀提取")
    parser.add_argument("events", nargs="+",
                        help="賽事代碼（如 2026mndu 2026cosp）")
    parser.add_argument("--fps", type=float, default=0.333,
                        help="每秒取幾幀（預設: 0.333 = 每 3 秒 1 幀）")
    parser.add_argument("--crop-only", action="store_true",
                        help="只設定裁切範圍，不提取幀")
    parser.add_argument("--extract-only", action="store_true",
                        help="只提取幀（需已有 crop.json）")
    args = parser.parse_args()

    for event in args.events:
        dataset_dir = Path(f"datasets/{event}")
        crop_file = dataset_dir / "crop.json"

        print(f"\n{'='*50}")
        print(f"  {event}")
        print(f"{'='*50}")

        # Step 1: 裁切範圍
        crop = None
        if not args.extract_only:
            if crop_file.is_file():
                crop = json.loads(crop_file.read_text())
                print(f"  已有 crop.json: ({crop['x']}, {crop['y']}) "
                      f"{crop['w']}x{crop['h']}")
                resp = input("  重新選取？(y/N) ").strip().lower()
                if resp == 'y':
                    crop = interactive_crop(event, dataset_dir)
                    if crop:
                        crop_file.write_text(
                            json.dumps(crop, indent=2))
            else:
                crop = interactive_crop(event, dataset_dir)
                if crop:
                    crop_file.write_text(json.dumps(crop, indent=2))
                    print(f"  已存到: {crop_file}")

        if crop is None and crop_file.is_file():
            crop = json.loads(crop_file.read_text())

        if crop is None:
            print(f"  [SKIP] 沒有裁切範圍，跳過 {event}")
            continue

        # Step 2: 提取幀
        if not args.crop_only:
            print(f"\n  提取幀 (每 {1/args.fps:.0f} 秒 1 幀)...")
            n = extract_cropped_frames(event, dataset_dir, crop,
                                       fps=args.fps)
            print(f"  {event} 共 {n} 張裁切幀")

    # 總結
    print(f"\n{'='*50}")
    print(f"  完成！")
    print(f"{'='*50}")
    total = 0
    for event in args.events:
        img_dir = Path(f"datasets/{event}/images")
        if img_dir.is_dir():
            n = sum(1 for p in img_dir.iterdir() if p.suffix == ".jpg")
            total += n
            print(f"  {event}: {n} 張")
    print(f"  合計: {total} 張裁切幀")
    print(f"\n  下一步:")
    print(f"  python auto_annotate.py --images datasets/<event>/images "
          f"-o datasets/<event>")


if __name__ == "__main__":
    main()
