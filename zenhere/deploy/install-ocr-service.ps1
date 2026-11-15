# Installs the OCR worker as a Windows service with NSSM. Run as Administrator.
param(
  [string]$Root = "C:\zenhere",
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [int]$Port = 8090
)
$dir = Join-Path $Root "ocr-worker"
$python = Join-Path $dir ".venv\Scripts\python.exe"
$models = Join-Path $dir "models"

& $Nssm install zenhere-ocr $python "-m uvicorn app:app --host 127.0.0.1 --port $Port"
& $Nssm set zenhere-ocr AppDirectory $dir
# file names below must match the files downloaded from the model card
& $Nssm set zenhere-ocr AppEnvironmentExtra "OCR_DET_MODEL=$models\det.onnx" "OCR_REC_MODEL=$models\rec.onnx" "OCR_REC_KEYS=$models\keys.txt"
& $Nssm set zenhere-ocr Start SERVICE_AUTO_START
& $Nssm set zenhere-ocr AppExit Default Restart
& $Nssm set zenhere-ocr AppRestartDelay 5000
& $Nssm set zenhere-ocr AppStdout (Join-Path $Root "logs\ocr.out.log")
& $Nssm set zenhere-ocr AppStderr (Join-Path $Root "logs\ocr.err.log")
& $Nssm start zenhere-ocr
Write-Host "zenhere-ocr installed. Health check: http://127.0.0.1:$Port/health"
