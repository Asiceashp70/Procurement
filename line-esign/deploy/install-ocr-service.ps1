# Installs the OCR worker as a Windows service with NSSM. Run as Administrator.
param(
  [string]$Root = "C:\esign",
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [int]$Port = 8090
)
$dir = Join-Path $Root "ocr-worker"
$python = Join-Path $dir ".venv\Scripts\python.exe"
$models = Join-Path $dir "models"

& $Nssm install esign-ocr $python "-m uvicorn app:app --host 127.0.0.1 --port $Port"
& $Nssm set esign-ocr AppDirectory $dir
# file names below must match the files downloaded from the model card
& $Nssm set esign-ocr AppEnvironmentExtra "OCR_DET_MODEL=$models\det.onnx" "OCR_REC_MODEL=$models\rec.onnx" "OCR_REC_KEYS=$models\keys.txt"
& $Nssm set esign-ocr Start SERVICE_AUTO_START
& $Nssm set esign-ocr AppExit Default Restart
& $Nssm set esign-ocr AppRestartDelay 5000
& $Nssm set esign-ocr AppStdout (Join-Path $Root "logs\ocr.out.log")
& $Nssm set esign-ocr AppStderr (Join-Path $Root "logs\ocr.err.log")
& $Nssm start esign-ocr
Write-Host "esign-ocr installed. Health check: http://127.0.0.1:$Port/health"
