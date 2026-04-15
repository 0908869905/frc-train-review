"""
收集各賽事 Gemini 標註結果到 datasets/notyet/ 統一資料夾

用法:
    # 收集所有新賽事的 Gemini 標註到 notyet
    python collect_to_notyet.py 2026inmis 2026vaale 2026sccha ...

    # 自動偵測：收集所有有 labels_raw 但未在 notyet 中的賽事
    python collect_to_notyet.py --auto

流程:
    1. 從 datasets/<event>/images_sample/ 複製圖片到 datasets/notyet/images/
    2. 從 datasets/<event>/labels_raw/ 複製標註到 datasets/notyet/labels/
    3. 檔名加 event prefix 避免衝突（如 2026inmis_frame_000001.jpg）
    4. 跳過已在 notyet 中的檔案
"""

import argparse
import shutil
from pathlib import Path

DATASET_ROOT = Path("datasets")
NOTYET = DATASET_ROOT / "notyet"
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def collect_event(event: str, img_sub: str = "images_sample",
                  lbl_sub: str = "labels_raw") -> int:
    """收集一個賽事的圖片+標註到 notyet/。回傳收集數量。"""
    event_dir = DATASET_ROOT / event
    img_dir = event_dir / img_sub
    lbl_dir = event_dir / lbl_sub

    if not img_dir.is_dir():
        print(f"  [SKIP] {event}: {img_sub}/ 不存在")
        return 0
    if not lbl_dir.is_dir():
        print(f"  [SKIP] {event}: {lbl_sub}/ 不存在")
        return 0

    out_img = NOTYET / "images"
    out_lbl = NOTYET / "labels"
    out_img.mkdir(parents=True, exist_ok=True)
    out_lbl.mkdir(parents=True, exist_ok=True)

    count = 0
    for img_path in sorted(img_dir.iterdir()):
        if img_path.suffix.lower() not in IMAGE_EXTS:
            continue

        lbl_path = lbl_dir / (img_path.stem + ".txt")
        if not lbl_path.is_file():
            continue  # 沒有標註，跳過

        # 空標註也跳過
        if lbl_path.stat().st_size == 0:
            continue

        # 加 event prefix
        out_name = f"{event}_{img_path.name}"
        out_lbl_name = f"{event}_{img_path.stem}.txt"

        dst_img = out_img / out_name
        dst_lbl = out_lbl / out_lbl_name

        if dst_img.exists():
            continue  # 已收集過

        shutil.copy2(img_path, dst_img)
        shutil.copy2(lbl_path, dst_lbl)
        count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="收集 Gemini 標註到 notyet/ 統一資料夾")
    parser.add_argument("events", nargs="*",
                        help="賽事代碼（如 2026inmis 2026vaale）")
    parser.add_argument("--auto", action="store_true",
                        help="自動偵測所有有 labels_raw 的賽事")
    parser.add_argument("--images", default="images_sample",
                        help="圖片子目錄名稱（預設: images_sample）")
    parser.add_argument("--labels", default="labels_raw",
                        help="標註子目錄名稱（預設: labels_raw）")
    args = parser.parse_args()

    if args.auto:
        events = []
        for d in sorted(DATASET_ROOT.iterdir()):
            if d.is_dir() and d.name.startswith("202") and d.name != "notyet":
                if (d / args.labels).is_dir():
                    events.append(d.name)
    else:
        events = args.events

    if not events:
        print("[ERROR] 沒有指定賽事。用 --auto 自動偵測或指定賽事代碼。")
        return

    print(f"收集 {len(events)} 個賽事到 {NOTYET}/")
    print(f"{'='*50}")

    total = 0
    for event in events:
        n = collect_event(event, args.images, args.labels)
        total += n
        if n > 0:
            print(f"  {event}: {n} 張")
        else:
            print(f"  {event}: 0 張（已收集或無資料）")

    # 統計
    n_img = sum(1 for _ in (NOTYET / "images").glob("*.*")) if (NOTYET / "images").is_dir() else 0
    n_lbl = sum(1 for _ in (NOTYET / "labels").glob("*.txt")) if (NOTYET / "labels").is_dir() else 0

    print(f"\n{'='*50}")
    print(f"  本次新增: {total} 張")
    print(f"  notyet 總計: {n_img} 張圖片, {n_lbl} 個標註")
    print(f"\n  下一步: 4 人分工審核")
    print(f"  python label_editor.py {NOTYET} --start 0 --end N")


if __name__ == "__main__":
    main()
