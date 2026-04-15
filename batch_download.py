"""
批次下載多個 FRC 賽事影片

用法:
    python batch_download.py --tba-key YOUR_KEY
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

EVENTS = [
    "2026inmis",   # FIN District Mishawaka (93 matches)
    "2026vaale",   # FCH District Alexandria (96 matches)
    "2026sccha",   # FSC District N. Charleston (17 matches)
    "2026txbel",   # FIT District Belton (35 matches)
    "2026mimtp",   # FIM District Mt Pleasant (95 matches)
    "2026nccab",   # FNC District Cabarrus (71 matches)
    "2026ncwak",   # FNC District Wake County (74 matches)
    "2026njwas",   # FMA District Warren Hills (40 matches)
    "2026pahat",   # FMA District Hatboro-Horsham (81 matches)
]


def main():
    parser = argparse.ArgumentParser(description="Batch download FRC event videos")
    parser.add_argument("--tba-key", required=True, help="TBA API key")
    parser.add_argument("--fps", type=float, default=1.0, help="Frame extraction FPS")
    parser.add_argument("--skip-extract", action="store_true", help="Skip frame extraction")
    parser.add_argument("--events", nargs="*", help="Only download specific events")
    args = parser.parse_args()

    events = args.events if args.events else EVENTS
    # Skip events that already have videos
    to_download = []
    for ek in events:
        vdir = Path(f"datasets/{ek}/videos")
        if vdir.is_dir() and any(vdir.glob("*.mp4")):
            n = sum(1 for _ in vdir.glob("*.mp4"))
            print(f"[SKIP] {ek}: already has {n} videos")
            continue
        to_download.append(ek)

    if not to_download:
        print("All events already downloaded!")
        return

    print(f"\nWill download {len(to_download)} events: {', '.join(to_download)}")
    print(f"{'='*60}\n")

    t0 = time.time()
    for i, ek in enumerate(to_download):
        print(f"\n{'='*60}")
        print(f"  [{i+1}/{len(to_download)}] {ek}")
        print(f"{'='*60}")

        cmd = [
            sys.executable, "download_matches.py", ek,
            "--tba-key", args.tba_key,
            "--max-height", "720",
            "--fps", str(args.fps),
        ]
        if args.skip_extract:
            cmd.append("--skip-extract")

        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[WARN] {ek} finished with errors")

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"  Batch download complete! ({elapsed/60:.0f} min)")
    print(f"{'='*60}")

    # Summary
    for ek in events:
        vdir = Path(f"datasets/{ek}/videos")
        idir = Path(f"datasets/{ek}/images_raw")
        nv = sum(1 for _ in vdir.glob("*.mp4")) if vdir.is_dir() else 0
        ni = sum(1 for _ in idir.glob("*.jpg")) if idir.is_dir() else 0
        print(f"  {ek}: {nv} videos, {ni} frames")

    print(f"\nNext: python crop_events.py {' '.join(events)}")


if __name__ == "__main__":
    main()
