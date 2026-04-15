"""
合併所有審核完成的資料集為統一 YOLO 訓練格式

來源:
  - 2024mslr/yolo_dataset (817 張, 已 train/val split)
  - 2026mndu, 2026cosp, 2026okok, 2026bcvi, 2026tuis (各 ~200 張有效)
  - reviewed/ (新賽事人工審核完的標註)

輸出: datasets/merged/  (train/val 80/20 split)
"""

import os
import random
import shutil
from pathlib import Path

DATASET_ROOT = Path("datasets")
OUTPUT = DATASET_ROOT / "merged"

# 來源定義
SOURCES = [
    # (event, images_dir, labels_dir)
    ("2024mslr", "yolo_dataset/images/train", "yolo_dataset/labels/train"),
    ("2024mslr", "yolo_dataset/images/val", "yolo_dataset/labels/val"),
    ("2026mndu", "images_sample", "labels_raw"),
    ("2026cosp", "images_sample", "labels_raw"),
    ("2026okok", "images_sample", "labels_raw"),
    ("2026bcvi", "images_sample", "labels_raw"),
    ("2026tuis", "images_sample", "labels_raw"),
    # 新賽事人工審核完的標註
    ("reviewed", "images", "labels"),
]

VAL_RATIO = 0.2
SEED = 42


def main():
    random.seed(SEED)

    # 收集所有有效的 (image_path, label_path) 對
    pairs = []
    for event, img_sub, lbl_sub in SOURCES:
        img_dir = DATASET_ROOT / event / img_sub
        lbl_dir = DATASET_ROOT / event / lbl_sub
        if not img_dir.is_dir():
            print(f"  [SKIP] {img_dir} 不存在")
            continue

        count = 0
        for img_path in sorted(img_dir.glob("*.jpg")):
            lbl_path = lbl_dir / (img_path.stem + ".txt")
            # 只包含有標註（非空）的圖片
            if lbl_path.is_file() and lbl_path.stat().st_size > 0:
                # 加 event prefix 避免檔名衝突
                prefix = event + "_"
                # 2024mslr yolo_dataset 已有唯一名稱，不需 prefix
                if event == "2024mslr":
                    prefix = ""
                pairs.append((img_path, lbl_path, prefix + img_path.name))
                count += 1
        print(f"  {event}/{img_sub}: {count} 張有效")

    print(f"\n  總計: {len(pairs)} 張")

    # 隨機 shuffle + split
    random.shuffle(pairs)
    val_count = int(len(pairs) * VAL_RATIO)
    val_pairs = pairs[:val_count]
    train_pairs = pairs[val_count:]

    print(f"  Train: {len(train_pairs)}, Val: {len(val_pairs)}")

    # 建立輸出目錄
    for split in ["train", "val"]:
        (OUTPUT / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT / "labels" / split).mkdir(parents=True, exist_ok=True)

    # 複製檔案
    for split_name, split_pairs in [("train", train_pairs), ("val", val_pairs)]:
        for img_path, lbl_path, out_name in split_pairs:
            shutil.copy2(img_path, OUTPUT / "images" / split_name / out_name)
            shutil.copy2(lbl_path, OUTPUT / "labels" / split_name /
                        (Path(out_name).stem + ".txt"))

    # 寫 data.yaml
    yaml_content = f"""path: {OUTPUT.resolve().as_posix()}
train: images/train
val: images/val

names:
  0: Red
  1: Blue
"""
    (OUTPUT / "data.yaml").write_text(yaml_content)
    print(f"\n  輸出: {OUTPUT}")
    print(f"  data.yaml: {OUTPUT / 'data.yaml'}")


if __name__ == "__main__":
    main()
