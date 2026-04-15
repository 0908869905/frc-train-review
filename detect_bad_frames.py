"""偵測訓練資料集中的壞幀（過曝/異常亮 + bbox 異常多）"""

import os
import cv2
import numpy as np
from pathlib import Path

DATASET_ROOT = Path("datasets/merged")
SPLITS = ["train", "val"]

# 閾值
BRIGHTNESS_THRESHOLD = 200  # 平均亮度超過此值視為過曝
MAX_BBOX_COUNT = 8          # 正常最多 6 bumpers，超過此數視為異常
MIN_STD_THRESHOLD = 30      # 標準差太低 = 畫面幾乎純色

results = []

for split in SPLITS:
    img_dir = DATASET_ROOT / "images" / split
    lbl_dir = DATASET_ROOT / "labels" / split

    for img_file in sorted(img_dir.iterdir()):
        if img_file.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue

        img = cv2.imread(str(img_file))
        if img is None:
            results.append({
                "file": img_file.name,
                "split": split,
                "reason": "UNREADABLE",
                "brightness": -1,
                "std": -1,
                "bbox_count": -1,
            })
            continue

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        mean_brightness = float(np.mean(gray))
        std_brightness = float(np.std(gray))

        # 讀取對應 label
        lbl_file = lbl_dir / (img_file.stem + ".txt")
        bbox_count = 0
        if lbl_file.exists():
            with open(lbl_file) as f:
                lines = [l.strip() for l in f if l.strip()]
                bbox_count = len(lines)

        # 判定壞幀條件
        reasons = []
        if mean_brightness > BRIGHTNESS_THRESHOLD:
            reasons.append("BRIGHT")
        if std_brightness < MIN_STD_THRESHOLD:
            reasons.append("LOW_STD")
        if bbox_count > MAX_BBOX_COUNT:
            reasons.append(f"BBOX={bbox_count}")

        # 空標註（0 bbox）也標記，但不算壞幀
        if reasons:
            results.append({
                "file": img_file.name,
                "split": split,
                "reason": " + ".join(reasons),
                "brightness": mean_brightness,
                "std": std_brightness,
                "bbox_count": bbox_count,
            })

# 輸出結果
print(f"\n{'='*80}")
print(f"掃描完成：{sum(1 for s in SPLITS for _ in (DATASET_ROOT / 'images' / s).iterdir())} 張圖片")
print(f"異常幀數：{len(results)}")
print(f"{'='*80}\n")

if results:
    # 按嚴重程度排序：多重問題 > 單一問題
    results.sort(key=lambda r: (-r["reason"].count("+"), -r["brightness"]))

    print(f"{'檔名':<50} {'split':<6} {'亮度':>6} {'標準差':>6} {'bbox':>5}  原因")
    print("-" * 100)
    for r in results:
        print(f"{r['file']:<50} {r['split']:<6} {r['brightness']:>6.1f} {r['std']:>6.1f} {r['bbox_count']:>5}  {r['reason']}")

    # 分類統計
    bright_and_bbox = [r for r in results if "BRIGHT" in r["reason"] and "BBOX" in r["reason"]]
    bright_only = [r for r in results if "BRIGHT" in r["reason"] and "BBOX" not in r["reason"]]
    bbox_only = [r for r in results if "BBOX" in r["reason"] and "BRIGHT" not in r["reason"]]
    low_std = [r for r in results if "LOW_STD" in r["reason"]]

    print(f"\n--- 分類統計 ---")
    print(f"過曝 + bbox 異常多：{len(bright_and_bbox)} 張（最嚴重，建議刪除）")
    print(f"僅過曝：           {len(bright_only)} 張")
    print(f"僅 bbox 異常多：   {len(bbox_only)} 張")
    print(f"低標準差（純色）：  {len(low_std)} 張")
else:
    print("未發現異常幀！")
