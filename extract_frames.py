"""
影片取幀工具 — 從 FRC 比賽影片提取訓練用圖片

用法:
    # 每秒取 1 幀（預設）
    python extract_frames.py video.mp4

    # 每秒取 2 幀
    python extract_frames.py video.mp4 --fps 2

    # 指定輸出目錄
    python extract_frames.py video.mp4 -o frames/match1

    # 只取中間 30 秒（跳過開頭 10 秒，取到 40 秒）
    python extract_frames.py video.mp4 --start 10 --end 40

    # 處理多個影片
    python extract_frames.py video1.mp4 video2.mp4 video3.mp4

取幀後，使用 Roboflow 免費標註工具標註 bounding box：
    1. 到 https://app.roboflow.com 建立專案
    2. 上傳取出的圖片
    3. 標註 Red / Blue 兩個類別
    4. 匯出 YOLOv11 格式
    5. 合併到訓練資料集
"""

import argparse
import sys
from pathlib import Path

import cv2


def extract_frames(
    video_path: str,
    output_dir: str,
    target_fps: float = 1.0,
    start_sec: float = 0,
    end_sec: float | None = None,
    prefix: str = "",
) -> int:
    """從影片提取幀。

    Args:
        video_path: 影片路徑
        output_dir: 輸出目錄
        target_fps: 每秒取幾幀
        start_sec: 開始時間（秒）
        end_sec: 結束時間（秒），None = 到影片結束
        prefix: 檔名前綴

    Returns:
        提取的幀數
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] 無法開啟影片: {video_path}")
        return 0

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / video_fps if video_fps > 0 else 0

    if end_sec is None:
        end_sec = duration

    print(f"影片: {video_path}")
    print(f"  解析度: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}")
    print(f"  FPS: {video_fps:.1f}, 總幀數: {total_frames}, 長度: {duration:.1f}s")
    print(f"  取幀範圍: {start_sec:.1f}s ~ {end_sec:.1f}s, 每秒 {target_fps} 幀")

    # 計算取幀間隔
    frame_interval = int(video_fps / target_fps) if target_fps > 0 else int(video_fps)
    start_frame = int(start_sec * video_fps)
    end_frame = int(end_sec * video_fps)

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    frame_idx = start_frame
    saved = 0

    while frame_idx < end_frame:
        ret, frame = cap.read()
        if not ret:
            break

        if (frame_idx - start_frame) % frame_interval == 0:
            timestamp = frame_idx / video_fps
            filename = f"{prefix}frame_{frame_idx:06d}_t{timestamp:.1f}s.jpg"
            filepath = out_path / filename
            cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
            saved += 1

        frame_idx += 1

    cap.release()
    print(f"  已儲存 {saved} 張圖片至: {out_path}")
    return saved


def main():
    parser = argparse.ArgumentParser(
        description="從 FRC 比賽影片提取訓練用圖片")

    parser.add_argument("videos", nargs="+", help="影片檔案路徑（支援多個）")
    parser.add_argument("-o", "--output", default="datasets/custom_frames",
                        help="輸出目錄（預設: datasets/custom_frames）")
    parser.add_argument("--fps", type=float, default=1.0,
                        help="每秒取幾幀（預設: 1）")
    parser.add_argument("--start", type=float, default=0,
                        help="開始時間（秒）")
    parser.add_argument("--end", type=float, default=None,
                        help="結束時間（秒），不指定則到結尾")
    args = parser.parse_args()

    total_saved = 0
    for i, video in enumerate(args.videos):
        if not Path(video).exists():
            print(f"[WARN] 影片不存在，跳過: {video}")
            continue

        # 多影片時用不同前綴避免檔名衝突
        prefix = f"v{i}_" if len(args.videos) > 1 else ""
        saved = extract_frames(
            video_path=video,
            output_dir=args.output,
            target_fps=args.fps,
            start_sec=args.start,
            end_sec=args.end,
            prefix=prefix,
        )
        total_saved += saved

    print(f"\n共提取 {total_saved} 張圖片")
    print(f"\n下一步:")
    print(f"  1. 到 https://app.roboflow.com 建立專案（Object Detection）")
    print(f"  2. 上傳 {args.output}/ 中的圖片")
    print(f"  3. 標註兩個類別: Red, Blue（框選機器人底盤）")
    print(f"  4. 匯出 YOLOv11 格式，下載到 datasets/ 目錄")
    print(f"  5. 合併資料集後執行訓練:")
    print(f"     python train_robot_model.py --local-dataset datasets/merged/data.yaml")


if __name__ == "__main__":
    main()
