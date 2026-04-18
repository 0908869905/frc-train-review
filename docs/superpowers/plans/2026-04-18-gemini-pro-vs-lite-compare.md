# Gemini 3.1 Pro vs Flash Lite Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一次性離線實驗腳本 `compare_pro_vs_lite.py`，挑 6 張高密度 FRC 2026 REBUILT 畫面，對 `gemini-3.1-pro-preview` 與 `gemini-3.1-flash-lite-preview` 同 prompt 同 schema 發 API，輸出雙面板 PNG + console summary，讓使用者目視決策是否值得把 prod pipeline 從 Lite 升級到 Pro。

**Architecture:** 單一 Python 腳本，與 `auto_pipeline.py` 解耦但**import 重用**其 prompt、response schema、YOLO 轉換、Gemini client 建立函式，避免兩邊 prompt 分叉失真。流程分 4 階段（pick → annotate → draw → summary），中間產物落地於 `datasets/_compare_pro_vs_lite/`（已由 `datasets/` 全目錄 gitignore 覆蓋，不會進 git）。**不寫 unit test**（spec 第 9 節決定）— 驗證方式為實跑後人工檢視輸出。

**Tech Stack:** Python 3.11、`google-genai`、`opencv-python`、`pillow`、`asyncio`、既有 `auto_pipeline.py` 公用 API

---

## File Structure

**新增：**
- `compare_pro_vs_lite.py`（repo 根目錄）— 唯一腳本，~250 行

**Runtime 輸出（gitignored）：**
- `datasets/_compare_pro_vs_lite/manifest.json`
- `datasets/_compare_pro_vs_lite/images/*.jpg`（6 張原圖 copy）
- `datasets/_compare_pro_vs_lite/labels_pro/*.txt`
- `datasets/_compare_pro_vs_lite/labels_lite/*.txt`
- `datasets/_compare_pro_vs_lite/compare_<stem>.png`（6 張）

**修改：無**（`auto_pipeline.py` 完全不動）

---

## Task 1: 建立腳本骨架 + 常數與 import

**Files:**
- Create: `compare_pro_vs_lite.py`

- [ ] **Step 1: 寫檔案頭 + import + 常數**

```python
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
```

- [ ] **Step 2: 執行 smoke test 確認 import 不炸**

Run: `python compare_pro_vs_lite.py`
Expected: 印兩行後 raise `NotImplementedError: 骨架，後續 task 填入`

如果 import 錯誤（例如 `from auto_pipeline import ...` 失敗），檢查 repo 根目錄執行 + 上述符號是否真的存在於 `auto_pipeline.py`（用 `grep -n "def build_gemini_client" auto_pipeline.py` 確認）。

- [ ] **Step 3: Commit**

```bash
git add compare_pro_vs_lite.py
git commit -m "feat: scaffold gemini pro vs lite compare script"
```

---

## Task 2: 實作圖片挑選邏輯 `pick_images()`

**Files:**
- Modify: `compare_pro_vs_lite.py`

從 `datasets/frc-vision-notyet/labels/*.txt` 讀 Lite 已標結果、計算每張 (red, blue, fuel) 數量、套門檻、排序、取 top 6、把原圖 copy 到 `OUT_IMAGES/`。

- [ ] **Step 1: 新增 helper 函式 `count_classes(label_path: Path) -> tuple[int,int,int]`**

在 `main()` 之前加：

```python
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
```

- [ ] **Step 2: 新增 `pick_images()` 函式**

```python
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
    print(f"  主門檻 bumper≥{bm} & fuel≥{fm}: 命中 {len(matched)} 張")

    if len(matched) < TARGET_N:
        bm, fm = FALLBACK_FILTER
        matched = apply_filter(bm, fm)
        print(f"  Fallback 門檻 bumper≥{bm} & fuel≥{fm}: 命中 {len(matched)} 張")

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
```

- [ ] **Step 3: 在 `main()` 呼叫 `pick_images()` 並寫 manifest**

把 `main()` 改成：

```python
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
```

（注意：先移除前一 task 的 `raise NotImplementedError`。）

- [ ] **Step 4: 執行驗證**

Run: `python compare_pro_vs_lite.py`
Expected：
- 印「掃描 ... 共 N 個 label 檔」
- 印「主門檻 bumper≥3 & fuel≥10: 命中 X 張」
- 印「已挑選 6 張：...」
- `datasets/_compare_pro_vs_lite/images/` 有 6 張 jpg
- `datasets/_compare_pro_vs_lite/manifest.json` 存在、內容合理

若命中 0 張：檢查 `datasets/frc-vision-notyet/labels/` 是否真的有 label 檔（`ls datasets/frc-vision-notyet/labels/ | head`）。

- [ ] **Step 5: Commit**

```bash
git add compare_pro_vs_lite.py
git commit -m "feat: pick_images filters high-density frames + writes manifest"
```

---

## Task 3: 實作雙模型並行標註 `run_annotations()`

**Files:**
- Modify: `compare_pro_vs_lite.py`

對 6 張 × 2 模型 = 12 次 API call 用 `asyncio.gather` 並行，結果存 `labels_pro/` 和 `labels_lite/`。重用 `auto_pipeline.prep_image_bytes` / `to_yolo` / `save_yolo_labels`。

- [ ] **Step 1: 新增 `annotate_one_to_file()` async helper**

在 `pick_images` 之後加：

```python
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
```

- [ ] **Step 2: 新增 `run_annotations()` 函式**

```python
async def run_annotations(picked: list[dict]) -> list[dict]:
    """Fire 12 concurrent calls (6 imgs × 2 models), return all results."""
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
```

- [ ] **Step 3: 在 `main()` 呼叫**

在 manifest 寫入之後、return 之前加：

```python
    # Stage 2: 雙模型並行標註
    print("\n[Stage 2] 雙模型並行標註")
    anno_results = asyncio.run(run_annotations(picked))
```

- [ ] **Step 4: 執行驗證**

Run: `python compare_pro_vs_lite.py`
Expected：
- Stage 1 不變（已完成 → 沿用既有 manifest）
- Stage 2 印「完成 12 次 API 呼叫，耗時 Xs」
- `datasets/_compare_pro_vs_lite/labels_pro/*.txt` 有 6 個檔案
- `datasets/_compare_pro_vs_lite/labels_lite/*.txt` 有 6 個檔案
- 若全部 `[FAIL]`：檢查 `GEMINI_API_KEY` 是否在環境或 `.env`、`gemini-3.1-pro-preview` 是否對 API key 開放（部分帳號 preview 需額外授權，見錯誤訊息）

- [ ] **Step 5: Commit**

```bash
git add compare_pro_vs_lite.py
git commit -m "feat: run_annotations fires 6x2 concurrent gemini calls"
```

---

## Task 4: 繪圖 `draw_compare()` — 雙面板 PNG 合成

**Files:**
- Modify: `compare_pro_vs_lite.py`

對每張 raw image 畫兩份（各套 Pro / Lite 的 bboxes），頂端加標題列與計數，水平合併存 `compare_<stem>.png`。

- [ ] **Step 1: 新增繪圖 helper `draw_boxes_on_image()`**

```python
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
```

- [ ] **Step 2: 新增 `make_compare_png()` 主繪圖函式**

```python
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
            # Draw "API FAILED" panel
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

    # Add 8px black divider between panels
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
```

- [ ] **Step 3: 在 `main()` 呼叫**

在 Stage 2 之後加：

```python
    # Stage 3: 繪製雙面板 PNG
    print("\n[Stage 3] 繪製對比 PNG")
    results_by_key = {(r["stem"], r["model"]): r for r in anno_results}
    for entry in picked:
        out = make_compare_png(entry["stem"], results_by_key)
        if out:
            print(f"  {out.name}")
```

- [ ] **Step 4: 執行驗證**

Run: `python compare_pro_vs_lite.py`
Expected：
- Stage 3 印 6 個 `compare_<stem>.png` 名稱
- `datasets/_compare_pro_vs_lite/compare_*.png` 共 6 張
- 手動開其中一張：左右兩面板、左為 Pro / 右為 Lite、各有黑色 header 寫類別數、中間 8px 黑線、原圖清晰可辨識、bboxes 在正確位置

若 bbox 位置偏移：檢查 `load_yolo_labels` 是否正確解析 5 個欄位（YOLO 格式就是 `cls cx cy w h`，皆正規化 0–1）。

- [ ] **Step 5: Commit**

```bash
git add compare_pro_vs_lite.py
git commit -m "feat: make_compare_png renders side-by-side pro vs lite panels"
```

---

## Task 5: Console summary table + 收尾

**Files:**
- Modify: `compare_pro_vs_lite.py`

印出 markdown 格式 summary 讓使用者把輸出直接貼回對話。

- [ ] **Step 1: 新增 `print_summary()` 函式**

```python
def print_summary(picked: list[dict], results_by_key: dict, elapsed: float) -> None:
    """Print markdown summary table + runtime stats."""
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print()
    print("| stem | pro R/B/F/T | lite R/B/F/T | Δtotal |")
    print("|------|-------------|--------------|--------|")
    for e in picked:
        stem = e["stem"]
        pro = results_by_key.get((stem, MODEL_PRO), {})
        lite = results_by_key.get((stem, MODEL_LITE), {})

        def fmt(r: dict) -> str:
            if r.get("status") != "done":
                return "FAIL"
            return (f"{r['n_red']}/{r['n_blue']}/{r['n_fuel']}/"
                    f"{r['n_red'] + r['n_blue'] + r['n_fuel']}")

        pro_s = fmt(pro)
        lite_s = fmt(lite)
        if pro.get("status") == "done" and lite.get("status") == "done":
            pt = pro["n_red"] + pro["n_blue"] + pro["n_fuel"]
            lt = lite["n_red"] + lite["n_blue"] + lite["n_fuel"]
            delta = f"{pt - lt:+d}"
        else:
            delta = "N/A"
        # Truncate long stem to last 28 chars for table readability
        stem_disp = stem if len(stem) <= 28 else "..." + stem[-25:]
        print(f"| {stem_disp} | {pro_s} | {lite_s} | {delta} |")
    print()
    print(f"耗時：{elapsed:.1f}s")
    print(f"輸出目錄：{OUT_DIR}")
    print("開 6 張 compare_*.png 目視評估。")
```

- [ ] **Step 2: 在 `main()` 最後呼叫 + 統整時間**

修改 `main()` 為：

```python
def main():
    print("Gemini 3.1 Pro vs Flash Lite compare experiment")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t_start = time.time()

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

    # Stage 4: Summary
    elapsed = time.time() - t_start
    print_summary(picked, results_by_key, elapsed)
```

- [ ] **Step 3: 執行完整 end-to-end 驗證**

Run: `python compare_pro_vs_lite.py`
Expected：
- 全部 4 個 Stage 跑完無 exception
- 最後印出 markdown 表格 + 耗時
- `datasets/_compare_pro_vs_lite/` 含 6 張 compare PNG + 1 manifest + 2 labels 目錄 + 6 原圖

全部輸出貼回對話讓使用者決策。

- [ ] **Step 4: Commit**

```bash
git add compare_pro_vs_lite.py
git commit -m "feat: print_summary markdown table + end-to-end glue"
```

---

## 驗收條件

- [ ] `python compare_pro_vs_lite.py` 單次指令完成整個流程
- [ ] 產出 6 張 `compare_*.png`，人眼可看出 Pro vs Lite 的標註差異
- [ ] Console 印出 markdown summary 表，含每張的 R/B/F/Total 與 Δtotal
- [ ] 腳本完全不影響 `auto_pipeline.py`（`git diff` 只改 `compare_pro_vs_lite.py`）
- [ ] `datasets/_compare_pro_vs_lite/` 未 commit 進 git（已由 `datasets/` gitignore 涵蓋）

## 風險與應變

| 風險 | 應變 |
|---|---|
| `gemini-3.1-pro-preview` 對 API key 未開放 | Stage 2 會印 `[FAIL] ... error: ...`，訊息會帶 403/權限提示。Google AI Studio 免費層通常有 Pro preview，若沒有改申請或用付費 key |
| `frc-vision-notyet/labels/` 無 label 或都是空檔 | Stage 1 會中止並印分佈直方圖；實際上 pipeline 已跑過 3775 張，應該不會發生 |
| 篩選不到 6 張高密度圖 | 主門檻自動降 fallback；若仍不到 → 腳本中止要求手動調，不會靜默取少於 6 張 |
| Pro preview 有更低 rate limit | 既有 4 次指數 backoff（5s → 10s → 20s → 40s）應能吸收；若仍 fail 改 `CONCURRENCY = 6`（一張一張來） |
| bbox 位置錯位 | `to_yolo` 與 `load_yolo_labels` 的格式需對齊：都是正規化 0–1 的 (cx, cy, w, h)，問題通常在解析順序 |
