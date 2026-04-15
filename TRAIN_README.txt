========================================
  FRC Robot Detection Model Training
  機器人偵測模型訓練指南
========================================

需求：
  - Python 3.11+
  - NVIDIA GPU + CUDA

步驟：

1. 安裝依賴
   pip install -r requirements.txt
   pip install roboflow ultralytics

2. 訓練模型（約 20-30 分鐘）
   python train_robot_model.py --api-key YOUR_ROBOFLOW_API_KEY --device cuda:0

3. 訓練完成後，確認產出檔案：
   models/frc_robot.onnx

4. 把 models/frc_robot.onnx 複製回原電腦的 models/ 目錄即可

========================================
  如果遇到問題
========================================

CUDA 不可用：
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

記憶體不足 (OOM)：
  python train_robot_model.py --api-key YOUR_ROBOFLOW_API_KEY --device cuda:0 --batch 8
