"""
下載 FRC 比賽影片 — 從 TBA 取得 YouTube 連結 + yt-dlp 下載 + 提取訓練幀

用法:
    # 下載 2023 Magnolia Regional 所有比賽影片並提取幀
    python download_matches.py 2023mslr --tba-key YOUR_KEY

    # 2024 Magnolia Regional，每秒 2 幀
    python download_matches.py 2024mslr --tba-key YOUR_KEY --fps 2

    # 限制只下載前 10 場比賽（測試用）
    python download_matches.py 2023mslr --tba-key YOUR_KEY --max-matches 10

    # 只提取幀（已有影片）
    python download_matches.py 2023mslr --tba-key YOUR_KEY --skip-download

下載完成後:
    python auto_annotate.py --images datasets/2023mslr/images_raw -o datasets/2023mslr
    python train_robot_model.py --local-dataset datasets/2023mslr/data.yaml
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request

import cv2


# ═══════════════════════════════════════════════════════
# TBA API
# ═══════════════════════════════════════════════════════

def fetch_match_videos(event_key: str, tba_key: str) -> list[dict]:
    """Fetch match video YouTube IDs from TBA API.

    Returns one video per match (first YouTube link), sorted by
    match order (quals → semis → finals).
    """
    url = (f"https://www.thebluealliance.com/api/v3/"
           f"event/{event_key}/matches")
    req = Request(url, headers={
        "X-TBA-Auth-Key": tba_key,
        "User-Agent": "FRC-Scoring-Analyzer/1.0",
    })

    try:
        with urlopen(req) as resp:
            matches = json.loads(resp.read())
    except Exception as e:
        print(f"[ERROR] TBA API failed: {e}")
        sys.exit(1)

    level_order = {"qm": 0, "sf": 1, "f": 2}
    matches.sort(key=lambda m: (
        level_order.get(m["comp_level"], 9),
        m.get("set_number", 0),
        m["match_number"],
    ))

    # One video per match (first YouTube link, skip duplicates)
    seen_keys = set()
    videos = []
    for m in matches:
        mk = m["key"]
        if mk in seen_keys:
            continue
        seen_keys.add(mk)

        yt_vids = [v for v in m.get("videos", [])
                   if v.get("type") == "youtube"]
        if yt_vids:
            videos.append({
                "match_key": mk,
                "video_id": yt_vids[0]["key"],
                "comp_level": m["comp_level"],
                "match_number": m["match_number"],
            })

    return videos


# ═══════════════════════════════════════════════════════
# YouTube Download
# ═══════════════════════════════════════════════════════

def download_video(video_id: str, output_path: Path,
                   max_height: int = 720) -> bool:
    """Download YouTube video using yt-dlp. Returns True on success."""
    if output_path.is_file() and output_path.stat().st_size > 100_000:
        return True  # Already downloaded

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # yt-dlp format: best video ≤ max_height + best audio, merge to mp4
    fmt = (f"bestvideo[height<={max_height}]+bestaudio/"
           f"best[height<={max_height}]")

    cmd = [
        "yt-dlp",
        f"https://www.youtube.com/watch?v={video_id}",
        "-o", str(output_path),
        "-f", fmt,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--quiet",
        "--progress",
        "--no-overwrites",
    ]

    try:
        result = subprocess.run(cmd, timeout=300)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"  [TIMEOUT] Download exceeded 5 min")
        return False
    except FileNotFoundError:
        print("[ERROR] yt-dlp not found. Install: pip install yt-dlp")
        sys.exit(1)


# ═══════════════════════════════════════════════════════
# Frame Extraction
# ═══════════════════════════════════════════════════════

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def extract_frames(video_path: Path, output_dir: Path,
                   fps: float = 1.0,
                   prefix: str = "") -> int:
    """Extract frames from video at specified FPS.
    Returns number of saved frames."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  [ERROR] Cannot open: {video_path}")
        return 0

    vfps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = max(1, int(vfps / fps))

    output_dir.mkdir(parents=True, exist_ok=True)

    # Check if already extracted for this prefix
    existing = sum(1 for p in output_dir.iterdir()
                   if p.suffix.lower() in IMAGE_EXTS
                   and p.name.startswith(prefix))
    if existing > 0:
        cap.release()
        return existing  # Already extracted

    saved = 0
    fi = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fi % interval == 0:
            ts = fi / vfps
            name = f"{prefix}f{fi:06d}_t{ts:.1f}s.jpg"
            cv2.imwrite(str(output_dir / name), frame,
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            saved += 1
        fi += 1

    cap.release()
    return saved


# ═══════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Download FRC match videos from TBA + YouTube")

    parser.add_argument(
        "event_key",
        help="TBA event key (e.g., 2023mslr, 2024mslr)")
    parser.add_argument(
        "--tba-key", required=True,
        help="The Blue Alliance API key")
    parser.add_argument(
        "-o", "--output", default=None,
        help="Output directory (default: datasets/<event_key>)")
    parser.add_argument(
        "--fps", type=float, default=1.0,
        help="Frames per second to extract (default: 1)")
    parser.add_argument(
        "--max-height", type=int, default=720,
        help="Max video height for download (default: 720)")
    parser.add_argument(
        "--max-matches", type=int, default=None,
        help="Limit number of matches to download (for testing)")
    parser.add_argument(
        "--skip-download", action="store_true",
        help="Skip download, only extract frames from existing videos")
    parser.add_argument(
        "--skip-extract", action="store_true",
        help="Skip frame extraction (download only)")

    args = parser.parse_args()

    out_dir = Path(args.output) if args.output else Path(
        f"datasets/{args.event_key}")
    video_dir = out_dir / "videos"
    image_dir = out_dir / "images_raw"

    # ── Phase 1: Fetch match list from TBA ──
    print("=" * 60)
    print(f"  FRC Match Video Downloader")
    print(f"  Event: {args.event_key}")
    print("=" * 60)

    print("\n[Phase 1] Fetching match list from TBA...")
    videos = fetch_match_videos(args.event_key, args.tba_key)

    if args.max_matches:
        videos = videos[:args.max_matches]

    print(f"  Found {len(videos)} matches with YouTube videos")

    # Save video list for reference
    out_dir.mkdir(parents=True, exist_ok=True)
    list_file = out_dir / "match_videos.json"
    with open(list_file, "w", encoding="utf-8") as f:
        json.dump(videos, f, indent=2, ensure_ascii=False)
    print(f"  Video list saved: {list_file}")

    # ── Phase 2: Download videos ──
    if not args.skip_download:
        print(f"\n[Phase 2] Downloading {len(videos)} match videos "
              f"(max {args.max_height}p)...")
        video_dir.mkdir(parents=True, exist_ok=True)

        downloaded = 0
        skipped = 0
        failed = 0
        t0 = time.time()

        for i, v in enumerate(videos):
            mk = v["match_key"]
            vid = v["video_id"]
            # Clean filename from match key
            short = mk.replace(args.event_key + "_", "")
            vpath = video_dir / f"{short}.mp4"

            if vpath.is_file() and vpath.stat().st_size > 100_000:
                skipped += 1
                print(f"  [{i+1}/{len(videos)}] {short}: "
                      f"already downloaded")
                continue

            print(f"  [{i+1}/{len(videos)}] {short}: "
                  f"downloading {vid}...", end=" ", flush=True)

            ok = download_video(vid, vpath, args.max_height)
            if ok:
                size_mb = vpath.stat().st_size / (1024 * 1024)
                downloaded += 1
                print(f"OK ({size_mb:.1f} MB)")
            else:
                failed += 1
                print("FAILED")

        elapsed = time.time() - t0
        print(f"\n  Download done in {elapsed:.0f}s")
        print(f"  Downloaded: {downloaded}, Skipped: {skipped}, "
              f"Failed: {failed}")

        # Total video size
        total_mb = sum(
            f.stat().st_size for f in video_dir.iterdir()
            if f.suffix == ".mp4"
        ) / (1024 * 1024)
        print(f"  Total video size: {total_mb:.0f} MB")
    else:
        print("\n[Phase 2] Skipping download (--skip-download)")

    # ── Phase 3: Extract frames ──
    if not args.skip_extract:
        print(f"\n[Phase 3] Extracting frames at {args.fps} fps...")
        image_dir.mkdir(parents=True, exist_ok=True)

        # Find all downloaded videos
        mp4s = sorted(video_dir.glob("*.mp4"))
        if not mp4s:
            print(f"  [ERROR] No videos found in {video_dir}")
            sys.exit(1)

        total_frames = 0
        t0 = time.time()

        for i, vp in enumerate(mp4s):
            prefix = f"{vp.stem}_"
            n = extract_frames(vp, image_dir, fps=args.fps,
                               prefix=prefix)
            total_frames += n
            print(f"  [{i+1}/{len(mp4s)}] {vp.name}: "
                  f"{n} frames")

        elapsed = time.time() - t0
        print(f"\n  Extraction done in {elapsed:.0f}s")
        print(f"  Total frames: {total_frames}")
    else:
        print("\n[Phase 3] Skipping extraction (--skip-extract)")

    # ── Summary ──
    n_images = sum(1 for p in image_dir.iterdir()
                   if p.suffix.lower() in IMAGE_EXTS) if image_dir.is_dir() else 0

    print()
    print("=" * 60)
    print("  Done!")
    print("=" * 60)
    print(f"  Videos:  {video_dir}")
    print(f"  Frames:  {image_dir} ({n_images} images)")
    print()
    print("  Next steps:")
    print(f"  1. Gemini auto-annotate:")
    print(f"     python auto_annotate.py "
          f"--images {image_dir} -o {out_dir}")
    print()
    print(f"  2. Train YOLO model:")
    print(f"     python train_robot_model.py "
          f"--local-dataset {out_dir}/data.yaml")
    print("=" * 60)


if __name__ == "__main__":
    main()
