"""
FRC Robot Detection Model Training Script

自動化訓練流程:
1. 從 Roboflow Universe 下載 FRC 機器人偵測資料集
2. 使用 ultralytics 訓練 YOLO 模型
3. 匯出 ONNX 到 models/frc_robot.onnx

需額外安裝（僅訓練時需要）:
    pip install roboflow ultralytics

推理時只需 onnxruntime，不需要 ultralytics。

用法:
    # 使用 Roboflow 資料集（需 API key）
    python train_robot_model.py --api-key YOUR_ROBOFLOW_KEY

    # 使用本地資料集（YOLO 格式目錄）
    python train_robot_model.py --local-dataset path/to/data.yaml

    # 自訂參數
    python train_robot_model.py --api-key KEY --model yolo26n --epochs 100 --imgsz 640
"""

import argparse
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
MODELS_DIR = PROJECT_ROOT / "models"
OUTPUT_MODEL = MODELS_DIR / "frc_robot.onnx"

# Roboflow 預設資料集（Main Robot Detection — FRC: Red / Blue 底盤偵測，1172 張）
DEFAULT_RF_WORKSPACE = "main-wcgiu"
DEFAULT_RF_PROJECT = "robot-detection-xru6m"
DEFAULT_RF_VERSION = 16


def download_roboflow_dataset(api_key: str, workspace: str, project: str,
                               version: int, save_dir: Path) -> Path:
    """從 Roboflow Universe 下載資料集。"""
    try:
        from roboflow import Roboflow
    except ImportError:
        print("[ERROR] 請先安裝 roboflow: pip install roboflow")
        sys.exit(1)

    print(f"正在從 Roboflow 下載資料集: {workspace}/{project} v{version}")
    rf = Roboflow(api_key=api_key)
    proj = rf.workspace(workspace).project(project)
    dataset = proj.version(version).download("yolov8", location=str(save_dir))
    data_yaml = save_dir / "data.yaml"
    if not data_yaml.exists():
        # Roboflow 可能在子目錄
        for p in save_dir.rglob("data.yaml"):
            data_yaml = p
            break
    print(f"資料集已下載至: {data_yaml}")
    return data_yaml


def train_model(data_yaml: Path, model_name: str = "yolo11n",
                epochs: int = 50, imgsz: int = 640,
                batch: int = 16, device: str = ""):
    """訓練 YOLO 模型。"""
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[ERROR] 請先安裝 ultralytics: pip install ultralytics")
        sys.exit(1)

    # 載入預訓練模型
    model_file = f"{model_name}.pt"
    print(f"\n載入預訓練模型: {model_file}")
    model = YOLO(model_file)

    # 訓練
    train_args = {
        "data": str(data_yaml),
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "project": str(PROJECT_ROOT / "runs"),
        "name": "frc_robot",
        "exist_ok": True,
        "verbose": True,
    }
    if device:
        train_args["device"] = device

    print(f"\n開始訓練:")
    print(f"  模型: {model_name}")
    print(f"  資料: {data_yaml}")
    print(f"  Epochs: {epochs}")
    print(f"  圖片大小: {imgsz}")
    print(f"  Batch size: {batch}")
    print()

    results = model.train(**train_args)
    print(f"\n訓練完成！最佳模型: {model.trainer.best}")

    return model, results


def export_onnx(model, output_path: Path, imgsz: int = 640):
    """匯出 ONNX 模型。"""
    print(f"\n匯出 ONNX 模型至: {output_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 匯出 ONNX
    export_path = model.export(format="onnx", imgsz=imgsz, simplify=True)

    # 複製到目標位置
    import shutil
    export_path = Path(export_path)
    if export_path != output_path:
        shutil.copy2(export_path, output_path)
        print(f"  已複製至: {output_path}")

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"  模型大小: {size_mb:.1f} MB")

    return output_path


def validate_model(model, data_yaml: Path):
    """驗證模型品質。"""
    print("\n正在驗證模型...")
    metrics = model.val(data=str(data_yaml))
    print(f"\n驗證結果:")
    print(f"  mAP50:    {metrics.box.map50:.3f}")
    print(f"  mAP50-95: {metrics.box.map:.3f}")
    print(f"  Precision: {metrics.box.mp:.3f}")
    print(f"  Recall:    {metrics.box.mr:.3f}")
    return metrics


def visualize_predictions(model, data_yaml: Path, output_dir: Path,
                           num_images: int = 20):
    """在驗證集上輸出偵測結果圖片。"""
    import yaml

    output_dir.mkdir(parents=True, exist_ok=True)

    with open(data_yaml) as f:
        data_cfg = yaml.safe_load(f)

    # 找驗證集圖片
    val_path = data_cfg.get("val", "")
    if not os.path.isabs(val_path):
        val_path = str(data_yaml.parent / val_path)

    val_dir = Path(val_path)
    if not val_dir.exists():
        print(f"[WARN] 驗證集目錄不存在: {val_dir}")
        return

    image_exts = {".jpg", ".jpeg", ".png", ".bmp"}
    images = [p for p in val_dir.iterdir()
              if p.suffix.lower() in image_exts][:num_images]

    if not images:
        print("[WARN] 驗證集中沒有圖片")
        return

    print(f"\n正在輸出 {len(images)} 張偵測結果圖片至: {output_dir}")

    results = model.predict(
        source=[str(p) for p in images],
        save=True,
        project=str(output_dir),
        name="predictions",
        exist_ok=True,
    )

    print(f"  已完成，請檢查: {output_dir / 'predictions'}")


def main():
    parser = argparse.ArgumentParser(
        description="FRC Robot Detection Model Training")

    # 資料來源
    data_group = parser.add_mutually_exclusive_group(required=True)
    data_group.add_argument(
        "--api-key", type=str,
        help="Roboflow API key（從 roboflow.com 取得）")
    data_group.add_argument(
        "--local-dataset", type=str,
        help="本地 YOLO 資料集的 data.yaml 路徑")

    # Roboflow 資料集設定
    parser.add_argument("--rf-workspace", type=str, default=DEFAULT_RF_WORKSPACE,
                        help="Roboflow workspace")
    parser.add_argument("--rf-project", type=str, default=DEFAULT_RF_PROJECT,
                        help="Roboflow project")
    parser.add_argument("--rf-version", type=int, default=DEFAULT_RF_VERSION,
                        help="Roboflow dataset version")

    # 訓練參數
    parser.add_argument("--model", type=str, default="yolo26n",
                        help="YOLO 模型名稱 (yolo26n, yolo26s, yolo11n 等)")
    parser.add_argument("--epochs", type=int, default=50,
                        help="訓練 epochs 數")
    parser.add_argument("--imgsz", type=int, default=640,
                        help="訓練圖片大小")
    parser.add_argument("--batch", type=int, default=16,
                        help="Batch size")
    parser.add_argument("--device", type=str, default="",
                        help="訓練裝置 (e.g., 'cuda:0', 'cpu')")

    # 輸出
    parser.add_argument("--output", type=str, default=str(OUTPUT_MODEL),
                        help="ONNX 模型輸出路徑")
    parser.add_argument("--skip-visualize", action="store_true",
                        help="跳過驗證集視覺化")

    args = parser.parse_args()

    # 1. 取得資料集
    if args.api_key:
        dataset_dir = PROJECT_ROOT / "datasets" / "frc_robot"
        data_yaml = download_roboflow_dataset(
            api_key=args.api_key,
            workspace=args.rf_workspace,
            project=args.rf_project,
            version=args.rf_version,
            save_dir=dataset_dir,
        )
    else:
        data_yaml = Path(args.local_dataset)
        if not data_yaml.exists():
            print(f"[ERROR] 資料集不存在: {data_yaml}")
            sys.exit(1)

    # 2. 訓練模型
    model, results = train_model(
        data_yaml=data_yaml,
        model_name=args.model,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
    )

    # 3. 驗證
    validate_model(model, data_yaml)

    # 4. 匯出 ONNX
    output_path = Path(args.output)
    export_onnx(model, output_path, imgsz=args.imgsz)

    # 5. 視覺化
    if not args.skip_visualize:
        vis_dir = PROJECT_ROOT / "runs" / "frc_robot_vis"
        visualize_predictions(model, data_yaml, vis_dir)

    print("\n" + "=" * 60)
    print("訓練完成！")
    print(f"ONNX 模型已匯出至: {output_path}")
    print()
    print("下一步:")
    print(f"  1. 確認 {output_path} 存在")
    print("  2. 啟動 FRC Scoring Analyzer: python main.py")
    print("  3. 系統將自動載入機器人偵測模型")
    print("=" * 60)


if __name__ == "__main__":
    main()
