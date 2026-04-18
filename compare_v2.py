"""
V2 Prompt Experiment: Aggressive bumper prompt re-run

Reuses the 6 images picked in v1 run (datasets/_compare_pro_vs_lite/images/)
and re-annotates with a rewritten prompt that de-emphasizes material ("pool
noodles") and emphasizes partial occlusion + expected count.

Output: datasets/_compare_pro_vs_lite_v2/
Summary: combined 4-column table (Pro v1/v2, Lite v1/v2).

Usage:
    python compare_v2.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from google.genai import types

from auto_pipeline import (
    CLASS_IDX,
    _RESPONSE_SCHEMA,
    build_gemini_client,
    prep_image_bytes,
    save_yolo_labels,
    to_yolo,
)
from compare_pro_vs_lite import (
    MANIFEST_PATH as V1_MANIFEST_PATH,
    MODEL_LITE,
    MODEL_PRO,
    OUT_DIR as V1_OUT_DIR,
    OUT_IMAGES as V1_OUT_IMAGES,
    OUT_LABELS_LITE as V1_OUT_LABELS_LITE,
    OUT_LABELS_PRO as V1_OUT_LABELS_PRO,
    load_yolo_labels,
    make_compare_png as _v1_make_compare_png,
)

# ═════════════════════════════════════════════════════════════
# v2 output paths (distinct from v1, so we keep both)
# ═════════════════════════════════════════════════════════════

PROJECT_ROOT = Path(__file__).parent.resolve()
OUT_DIR = PROJECT_ROOT / "datasets" / "_compare_pro_vs_lite_v2"
OUT_LABELS_PRO = OUT_DIR / "labels_pro"
OUT_LABELS_LITE = OUT_DIR / "labels_lite"

CONCURRENCY = 12

# ═════════════════════════════════════════════════════════════
# V2 Prompt: aggressive bumper + anti-occlusion
# ═════════════════════════════════════════════════════════════

_PROMPT_V2 = """\
Detect ALL objects in this FRC 2026 REBUILT competition image that belong \
to these three classes. Return a JSON array only.

1. "red_robot" — ANY red rectangular or horizontal colored mass at floor \
or low height. These are bumpers on the base of FRC robots.
   - The red region may be partially hidden behind yellow fuel balls, \
other robots, or field elements. Box the visible red portion even if \
only 30% is exposed.
   - May appear small or blurry if the robot is far away.
   - Material doesn't matter (fabric/plastic/whatever). If you see a red \
rectangular band near the floor, IT IS A BUMPER.

2. "blue_robot" — Same as red_robot but blue.

3. "fuel" — Bright yellow foam balls, approximately volleyball-sized \
(~20 cm diameter). Scattered on the floor, held in robot storage, or \
mid-air.

CRITICAL EXPECTATIONS:
- FRC matches have up to 6 robots on the field (3 red + 3 blue alliance). \
You SHOULD find multiple red_robot and blue_robot detections in most \
images. A typical match scene has 3-6 bumpers visible.
- Missing a bumper is WORSE than a false positive. Do not skip \
partially-occluded bumpers. Do not skip small/distant bumpers.
- Missing a fuel is also worse than a false positive. Fuel balls are the \
most numerous object on the field.

RULES:
- Ignore fuel balls smaller than ~30 px wide in the source image (too \
distant to verify).
- Do NOT label field structures, alliance station banners, audience \
shirts, or other non-target red/blue/yellow objects. Bumpers are always \
at ground level under a robot; fuel is always a clean round yellow ball.
- Provide tight bounding boxes that hug each object.

For each detection, output:
  "box_2d": [y_min, x_min, y_max, x_max] normalized 0-1000 (y first)
  "class": one of "red_robot", "blue_robot", "fuel"
"""


# ═════════════════════════════════════════════════════════════
# Annotation (copy of v1 but uses V2 prompt + v2 out dir)
# ═════════════════════════════════════════════════════════════


async def annotate_v2(
    client,
    model: str,
    img_path: Path,
    out_label_dir: Path,
    sem: asyncio.Semaphore,
) -> dict:
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
                        contents=[img_part, _PROMPT_V2],
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


async def run_v2(picked: list[dict]) -> list[dict]:
    OUT_LABELS_PRO.mkdir(parents=True, exist_ok=True)
    OUT_LABELS_LITE.mkdir(parents=True, exist_ok=True)
    client = build_gemini_client()
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = []
    for entry in picked:
        img = V1_OUT_IMAGES / f"{entry['stem']}.jpg"
        tasks.append(annotate_v2(client, MODEL_PRO, img, OUT_LABELS_PRO, sem))
        tasks.append(annotate_v2(client, MODEL_LITE, img, OUT_LABELS_LITE, sem))
    t0 = time.time()
    results = await asyncio.gather(*tasks)
    elapsed = time.time() - t0
    print(f"  完成 {len(results)} 次 API 呼叫，耗時 {elapsed:.1f}s")
    for r in results:
        if r["status"] != "done":
            print(f"  [FAIL] {r['stem']} via {r['model']}: {r['status']}")
    return results


# ═════════════════════════════════════════════════════════════
# Drawing: draw v2 panels (same format as v1, just different labels source)
# ═════════════════════════════════════════════════════════════


def make_compare_png_v2(stem: str, results_by_key: dict) -> Path | None:
    """Reuse v1 compare logic but swap output dir + label dirs."""
    # Monkey-patch style: the v1 function reads from V1_OUT_LABELS_*. We need
    # to render a fresh PNG for v2, so re-implement locally (it's short).
    from compare_pro_vs_lite import (
        add_header,
        draw_boxes_on_image,
    )

    img_path = V1_OUT_IMAGES / f"{stem}.jpg"
    raw = cv2.imdecode(np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if raw is None:
        return None

    pro_lbl = load_yolo_labels(OUT_LABELS_PRO / f"{stem}.txt")
    lite_lbl = load_yolo_labels(OUT_LABELS_LITE / f"{stem}.txt")

    def panel(labels, title: str, result: dict) -> np.ndarray:
        if result.get("status", "") != "done":
            p = raw.copy()
            h, w = p.shape[:2]
            cv2.rectangle(p, (0, 0), (w, h), (0, 0, 0), -1)
            cv2.putText(p, f"{title}: API FAILED", (30, h // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
            return p
        drawn = draw_boxes_on_image(raw, labels)
        counts = (result["n_red"], result["n_blue"], result["n_fuel"])
        return add_header(drawn, title, counts)

    pro_r = results_by_key.get((stem, MODEL_PRO), {"status": "missing"})
    lite_r = results_by_key.get((stem, MODEL_LITE), {"status": "missing"})
    left = panel(pro_lbl, "GEMINI 3.1 PRO (v2 prompt)", pro_r)
    right = panel(lite_lbl, "GEMINI 3.1 FLASH LITE (v2 prompt)", lite_r)
    h = left.shape[0]
    divider = np.zeros((h, 8, 3), dtype=np.uint8)
    combined = cv2.hconcat([left, divider, right])
    out_path = OUT_DIR / f"compare_{stem}.png"
    ok, buf = cv2.imencode(".png", combined)
    if not ok:
        return None
    out_path.write_bytes(buf.tobytes())
    return out_path


# ═════════════════════════════════════════════════════════════
# Combined 4-column summary (v1 labels + v2 labels)
# ═════════════════════════════════════════════════════════════


def count_labels(path: Path) -> tuple[int, int, int]:
    if not path.is_file():
        return (0, 0, 0)
    nr = nb = nf = 0
    for l in load_yolo_labels(path):
        if l[0] == CLASS_IDX["red_robot"]:
            nr += 1
        elif l[0] == CLASS_IDX["blue_robot"]:
            nb += 1
        elif l[0] == CLASS_IDX["fuel"]:
            nf += 1
    return (nr, nb, nf)


def print_combined_summary(picked: list[dict]) -> None:
    print("\n" + "=" * 80)
    print("Combined Summary — v1 (prod prompt) vs v2 (aggressive prompt)")
    print("=" * 80)
    print()
    print("| stem | Pro v1 R/B/F | Pro v2 R/B/F | Lite v1 R/B/F | Lite v2 R/B/F |")
    print("|------|--------------|--------------|---------------|---------------|")
    for e in picked:
        stem = e["stem"]
        p1 = count_labels(V1_OUT_LABELS_PRO / f"{stem}.txt")
        p2 = count_labels(OUT_LABELS_PRO / f"{stem}.txt")
        l1 = count_labels(V1_OUT_LABELS_LITE / f"{stem}.txt")
        l2 = count_labels(OUT_LABELS_LITE / f"{stem}.txt")

        def fmt(t):
            return f"{t[0]}/{t[1]}/{t[2]}"
        stem_disp = stem if len(stem) <= 28 else "..." + stem[-25:]
        print(f"| {stem_disp} | {fmt(p1)} | {fmt(p2)} | {fmt(l1)} | {fmt(l2)} |")
    print()

    # Bumper-focused analysis
    print("Bumper detection (Red+Blue) only:")
    print("| stem | Pro v1 | Pro v2 | Lite v1 | Lite v2 |")
    print("|------|--------|--------|---------|---------|")
    for e in picked:
        stem = e["stem"]
        p1 = count_labels(V1_OUT_LABELS_PRO / f"{stem}.txt")
        p2 = count_labels(OUT_LABELS_PRO / f"{stem}.txt")
        l1 = count_labels(V1_OUT_LABELS_LITE / f"{stem}.txt")
        l2 = count_labels(OUT_LABELS_LITE / f"{stem}.txt")
        stem_disp = stem if len(stem) <= 28 else "..." + stem[-25:]
        print(f"| {stem_disp} | {p1[0] + p1[1]} | {p2[0] + p2[1]} | {l1[0] + l1[1]} | {l2[0] + l2[1]} |")
    print()


# ═════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════


def main():
    print("Gemini Pro vs Lite — v2 aggressive prompt experiment")
    print("=" * 60)

    if not V1_MANIFEST_PATH.is_file():
        print(f"[ERROR] 缺 v1 manifest: {V1_MANIFEST_PATH}")
        print("  先跑 python compare_pro_vs_lite.py 建立基準")
        sys.exit(1)

    manifest = json.loads(V1_MANIFEST_PATH.read_text(encoding="utf-8"))
    picked = manifest["picked"]
    print(f"沿用 v1 選出的 {len(picked)} 張圖")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # v2 annotate
    print("\n[v2 Stage 1] 雙模型並行標註（新 prompt）")
    results = asyncio.run(run_v2(picked))

    # Draw v2 PNGs
    print("\n[v2 Stage 2] 繪製對比 PNG")
    results_by_key = {(r["stem"], r["model"]): r for r in results}
    for entry in picked:
        out = make_compare_png_v2(entry["stem"], results_by_key)
        if out:
            print(f"  {out.name}")

    # Combined summary
    print_combined_summary(picked)

    print(f"v2 輸出目錄：{OUT_DIR}")
    print(f"v1 輸出目錄：{V1_OUT_DIR}")
    print("開兩個目錄下的 compare_*.png 對照看。")


if __name__ == "__main__":
    main()
