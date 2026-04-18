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


def main():
    print("Gemini 3.1 Pro vs Flash Lite compare experiment")
    print("=" * 60)
    raise NotImplementedError("骨架，後續 task 填入")


if __name__ == "__main__":
    main()
