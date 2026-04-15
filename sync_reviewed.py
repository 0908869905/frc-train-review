"""
同步已審核標註 — 把 notyet/ 中已審核的搬到 reviewed/

用法:
    # 檢查狀態（不搬移）
    python sync_reviewed.py --dry-run

    # 執行搬移
    python sync_reviewed.py

    # 自訂目標資料夾
    python sync_reviewed.py --dest datasets/done

流程:
    1. 讀取 datasets/notyet/review_state.json（label_editor 審核標記）
    2. 已審核的圖片+標註搬到 datasets/reviewed/images/ + labels/
    3. 更新 review_state.json（移除已搬走的）
    4. 顯示統計

審核時用 label_editor:
    python label_editor.py datasets/notyet --images images --labels labels
    # 按 Space 標記已審核
"""

import argparse
import json
import shutil
from pathlib import Path

DATASET_ROOT = Path("datasets")
NOTYET = DATASET_ROOT / "notyet"
DEFAULT_DEST = Path("D:/FRC/scoring-analyzer/datasets/reviewed")
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def main():
    parser = argparse.ArgumentParser(
        description="把 notyet/ 已審核的搬到 reviewed/")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST,
                        help=f"目標資料夾（預設: {DEFAULT_DEST}）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只顯示會搬移什麼，不實際搬")
    args = parser.parse_args()

    review_file = NOTYET / "review_state.json"
    if not review_file.is_file():
        print("[INFO] 沒有 review_state.json，尚未開始審核。")
        print(f"  先用 label_editor 審核:")
        print(f"  python label_editor.py {NOTYET} --images images --labels labels")
        return

    data = json.loads(review_file.read_text(encoding="utf-8"))
    reviewed = set(data.get("reviewed", []))

    if not reviewed:
        print("[INFO] 沒有已審核的檔案。")
        return

    src_img = NOTYET / "images"
    src_lbl = NOTYET / "labels"
    dst_img = args.dest / "images"
    dst_lbl = args.dest / "labels"

    if not args.dry_run:
        dst_img.mkdir(parents=True, exist_ok=True)
        dst_lbl.mkdir(parents=True, exist_ok=True)

    moved = 0
    skipped = 0

    for name in sorted(reviewed):
        # 找圖片檔（可能是 .jpg 或 .png）
        img_src = None
        for ext in IMAGE_EXTS:
            candidate = src_img / name
            if candidate.suffix.lower() in IMAGE_EXTS and candidate.is_file():
                img_src = candidate
                break
            # 也試不帶副檔名的 name + ext
            candidate = src_img / (Path(name).stem + ext)
            if candidate.is_file():
                img_src = candidate
                break

        if img_src is None:
            # name 本身就是完整檔名
            img_src = src_img / name
            if not img_src.is_file():
                skipped += 1
                continue

        stem = img_src.stem
        lbl_src = src_lbl / (stem + ".txt")

        if args.dry_run:
            print(f"  [MOVE] {img_src.name}")
            moved += 1
            continue

        # 搬移圖片
        shutil.move(str(img_src), str(dst_img / img_src.name))

        # 搬移標註
        if lbl_src.is_file():
            shutil.move(str(lbl_src), str(dst_lbl / lbl_src.name))

        moved += 1

    # 更新 review_state.json（移除已搬走的）
    if not args.dry_run and moved > 0:
        remaining_images = {p.name for p in src_img.iterdir()
                           if p.suffix.lower() in IMAGE_EXTS} if src_img.is_dir() else set()
        new_reviewed = reviewed & remaining_images
        data["reviewed"] = sorted(new_reviewed)
        review_file.write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # 統計
    n_notyet = sum(1 for _ in src_img.glob("*.*")) if src_img.is_dir() else 0
    n_reviewed = sum(1 for _ in dst_img.glob("*.*")) if dst_img.is_dir() else 0

    action = "會搬移" if args.dry_run else "已搬移"
    print(f"\n{'='*50}")
    print(f"  {action}: {moved} 張")
    if skipped:
        print(f"  跳過（找不到檔案）: {skipped}")
    print(f"  notyet 剩餘: {n_notyet} 張")
    print(f"  reviewed 累計: {n_reviewed} 張")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
