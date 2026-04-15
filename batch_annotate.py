"""
批次取樣 + Gemini 自動標註 + 收集到 notyet/

用法:
    python batch_annotate.py --sample 400
    python batch_annotate.py --sample 400 --events 2026inmis 2026vaale
"""

import argparse
import random
import shutil
import subprocess
import sys
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}

EVENTS = [
    "2026inmis", "2026vaale", "2026sccha", "2026txbel",
    "2026mimtp", "2026nccab", "2026ncwak", "2026pahat",
]

DATASET_ROOT = Path("datasets")


def sample_images(event: str, n: int) -> int:
    """從 images/ 隨機抽 n 張到 images_sample/。回傳實際抽取數量。"""
    img_dir = DATASET_ROOT / event / "images"
    sample_dir = DATASET_ROOT / event / "images_sample"

    if not img_dir.is_dir():
        print(f"  [SKIP] {event}: images/ 不存在")
        return 0

    all_imgs = sorted(p for p in img_dir.iterdir()
                      if p.suffix.lower() in IMAGE_EXTS)

    if not all_imgs:
        print(f"  [SKIP] {event}: 沒有圖片")
        return 0

    # 如果已有 images_sample 且數量足夠，跳過
    if sample_dir.is_dir():
        existing = sum(1 for p in sample_dir.iterdir()
                       if p.suffix.lower() in IMAGE_EXTS)
        if existing >= n:
            print(f"  [SKIP] {event}: images_sample/ 已有 {existing} 張")
            return existing

    sample_dir.mkdir(parents=True, exist_ok=True)

    # 隨機抽樣
    random.seed(42)
    selected = random.sample(all_imgs, min(n, len(all_imgs)))

    copied = 0
    for p in selected:
        dst = sample_dir / p.name
        if not dst.exists():
            shutil.copy2(p, dst)
            copied += 1

    total = sum(1 for p in sample_dir.iterdir()
                if p.suffix.lower() in IMAGE_EXTS)
    print(f"  {event}: 抽樣 {copied} 張 (總計 {total}/{len(all_imgs)})")
    return total


def annotate_event(event: str) -> bool:
    """對一個賽事執行 Gemini 自動標註。"""
    sample_dir = DATASET_ROOT / event / "images_sample"
    lbl_dir = DATASET_ROOT / event / "labels_raw"

    if not sample_dir.is_dir():
        print(f"  [SKIP] {event}: 沒有 images_sample/")
        return False

    # 檢查已完成數量
    n_img = sum(1 for p in sample_dir.iterdir()
                if p.suffix.lower() in IMAGE_EXTS)
    n_lbl = sum(1 for p in lbl_dir.iterdir()
                if p.suffix == ".txt") if lbl_dir.is_dir() else 0

    if n_lbl >= n_img:
        print(f"  [SKIP] {event}: 已全部標註 ({n_lbl}/{n_img})")
        return True

    print(f"  {event}: 標註 {n_img - n_lbl} 張 (已完成 {n_lbl}/{n_img})")

    cmd = [
        sys.executable, "auto_annotate.py",
        "--images", str(sample_dir),
        "-o", str(DATASET_ROOT / event),
        "--skip-review",
    ]
    result = subprocess.run(cmd)
    return result.returncode == 0


def collect_to_notyet(events: list[str]) -> int:
    """收集所有賽事的標註到 notyet/。"""
    cmd = [sys.executable, "collect_to_notyet.py"] + events
    result = subprocess.run(cmd)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(
        description="批次取樣 + Gemini 標註 + 收集到 notyet/")
    parser.add_argument("--sample", type=int, default=400,
                        help="每個賽事抽樣數量（預設: 400）")
    parser.add_argument("--events", nargs="*", default=None,
                        help="指定賽事（預設: 全部 8 個）")
    parser.add_argument("--skip-sample", action="store_true",
                        help="跳過抽樣（已有 images_sample）")
    parser.add_argument("--skip-annotate", action="store_true",
                        help="跳過標註（已有 labels_raw）")
    parser.add_argument("--skip-collect", action="store_true",
                        help="跳過收集到 notyet/")
    args = parser.parse_args()

    events = args.events or EVENTS

    # Phase 1: 取樣
    if not args.skip_sample:
        print(f"\n{'='*50}")
        print(f"  Phase 1: 取樣 ({args.sample} 張/賽事)")
        print(f"{'='*50}")
        for event in events:
            sample_images(event, args.sample)

    # Phase 2: Gemini 標註
    if not args.skip_annotate:
        print(f"\n{'='*50}")
        print(f"  Phase 2: Gemini 自動標註")
        print(f"{'='*50}")
        for event in events:
            annotate_event(event)

    # Phase 3: 收集到 notyet/
    if not args.skip_collect:
        print(f"\n{'='*50}")
        print(f"  Phase 3: 收集到 notyet/")
        print(f"{'='*50}")
        collect_to_notyet(events)

    print(f"\n{'='*50}")
    print(f"  完成！")
    print(f"{'='*50}")
    print(f"  下一步: 4 人分工審核")
    n = sum(1 for p in (DATASET_ROOT / "notyet" / "images").glob("*.*")) \
        if (DATASET_ROOT / "notyet" / "images").is_dir() else 0
    print(f"  notyet/ 共 {n} 張待審核")
    print(f"  python label_editor.py datasets/notyet --images images --labels labels")


if __name__ == "__main__":
    main()
