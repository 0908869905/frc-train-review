"""
建構 YOLO 訓練資料集 — 只用人工校正過的標註

用法:
    python build_dataset.py                    # 建構資料集 + zip
    python build_dataset.py --no-zip           # 只建構，不打包
    python build_dataset.py --val-ratio 0.15   # 自訂驗證集比例

未來新增校正範圍：修改下方 CORRECTED_RANGES 即可。
"""

import argparse
import random
import shutil
import zipfile
from pathlib import Path

# ═══════════════════════════════════════════════════════
# 設定：人工校正完成的圖片範圍（1-based, inclusive）
# 新增校正範圍時，只需在這裡加一行
# ═══════════════════════════════════════════════════════
CORRECTED_RANGES = [
    (1, 616),       # 筆電 A 校正
    (1422, 1926),   # 筆電 B (洪家豪) 校正
]

# 路徑
DATASET_DIR = Path("datasets/2024mslr")
IMG_DIR = DATASET_DIR / "images"
LBL_DIR = DATASET_DIR / "labels_raw"
OUT_DIR = DATASET_DIR / "yolo_dataset"
ZIP_PATH = DATASET_DIR / "yolo_dataset.zip"

CLASS_NAMES = {0: "Red", 1: "Blue"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


def get_corrected_indices(total: int) -> set[int]:
    """Convert 1-based ranges to 0-based index set."""
    indices = set()
    for start, end in CORRECTED_RANGES:
        # 1-based inclusive → 0-based
        for i in range(start - 1, min(end, total)):
            indices.add(i)
    return indices


def build_dataset(val_ratio: float = 0.2, make_zip: bool = True):
    # List all images
    all_imgs = sorted(
        p for p in IMG_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS
    )
    total = len(all_imgs)
    print(f"Total images: {total}")

    # Get corrected indices
    corrected = get_corrected_indices(total)
    print(f"Corrected ranges: {CORRECTED_RANGES}")
    print(f"Corrected images: {len(corrected)}")

    # Filter: only corrected images with non-empty labels
    good = []
    skipped_no_label = 0
    skipped_empty = 0
    for idx in sorted(corrected):
        img_path = all_imgs[idx]
        lbl_path = LBL_DIR / f"{img_path.stem}.txt"
        if not lbl_path.is_file():
            skipped_no_label += 1
            continue
        text = lbl_path.read_text().strip()
        if not text:
            skipped_empty += 1
            continue
        good.append((img_path, lbl_path))

    print(f"Valid (with labels): {len(good)}")
    if skipped_no_label:
        print(f"  Skipped (no label file): {skipped_no_label}")
    if skipped_empty:
        print(f"  Skipped (empty label): {skipped_empty}")

    if not good:
        print("[ERROR] No valid images to export.")
        return

    # Count boxes
    total_red = 0
    total_blue = 0
    for _, lbl_path in good:
        for line in lbl_path.read_text().strip().splitlines():
            cls = int(line.split()[0])
            if cls == 0:
                total_red += 1
            elif cls == 1:
                total_blue += 1

    # Shuffle and split
    random.seed(42)
    random.shuffle(good)
    nv = max(1, int(len(good) * val_ratio))
    val_set = good[:nv]
    train_set = good[nv:]

    # Clean output
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)

    # Create directory structure
    for split in ("train", "val"):
        (OUT_DIR / "images" / split).mkdir(parents=True)
        (OUT_DIR / "labels" / split).mkdir(parents=True)

    # Copy files
    for split, items in [("train", train_set), ("val", val_set)]:
        for img_path, lbl_path in items:
            shutil.copy2(img_path, OUT_DIR / "images" / split / img_path.name)
            shutil.copy2(lbl_path, OUT_DIR / "labels" / split / lbl_path.name)

    # Generate data.yaml (absolute path for YOLO compatibility)
    yaml_path = OUT_DIR / "data.yaml"
    yaml_path.write_text(
        f"path: {OUT_DIR.resolve()}\n"
        "train: images/train\n"
        "val: images/val\n\n"
        "names:\n"
        "  0: Red\n"
        "  1: Blue\n",
        encoding="utf-8",
    )

    print(f"\nDataset exported -> {OUT_DIR}")
    print(f"  Train: {len(train_set)} images")
    print(f"  Val:   {nv} images")
    print(f"  Boxes: Red={total_red}, Blue={total_blue}")

    # Create zip for Colab upload
    if make_zip:
        if ZIP_PATH.exists():
            ZIP_PATH.unlink()
        with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in OUT_DIR.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(OUT_DIR))
        size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)
        print(f"\nZip created: {ZIP_PATH} ({size_mb:.1f} MB)")
        print("Upload this zip to Colab for training.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build YOLO dataset from corrected labels"
    )
    parser.add_argument("--val-ratio", type=float, default=0.2,
                        help="Validation set ratio (default: 0.2)")
    parser.add_argument("--no-zip", action="store_true",
                        help="Skip zip creation")
    args = parser.parse_args()

    build_dataset(val_ratio=args.val_ratio, make_zip=not args.no_zip)
