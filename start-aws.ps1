#!/usr/bin/env pwsh
<#
.SYNOPSIS
    EdgeGuardian – AWS Mode Startup Script
    Starts the local components needed to stream data to AWS.

.DESCRIPTION
    AWS handles: API Gateway + SQS + Lambda + DynamoDB (already deployed)
    This script starts:
      1. Mosquitto MQTT broker     (Docker — 1 container only)
      2. Anomaly Detector          (Python — native)
      3. Fog Node                  (Node.js — native)
      4. Sensor Simulator          (Python — native)
      5. React Dashboard           (Vite — native)

.USAGE
    .\start-aws.ps1
    .\start-aws.ps1 -SkipDashboard   # headless mode
#>

param(
    [switch]$SkipDashboard
)

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     EdgeGuardian — AWS Deployment Mode               ║" -ForegroundColor Cyan
Write-Host "║     Fog → API Gateway → SQS → Lambda → DynamoDB     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Mosquitto (Docker) ────────────────────────────────────────────────
Write-Host "[1/5] Starting Mosquitto MQTT broker (Docker)..." -ForegroundColor Yellow
docker compose -f "$ROOT\docker\docker-compose.aws.yml" up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "      ✗ Docker failed. Is Docker Desktop running?" -ForegroundColor Red
    exit 1
}
Write-Host "      ✓ Mosquitto running on port 1883" -ForegroundColor Green
Start-Sleep -Seconds 3

# ── Step 2: Anomaly Detector (Python) ────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Starting Anomaly Detector (Edge AI)..." -ForegroundColor Yellow

# Install Python deps if needed
$reqFile = "$ROOT\fog-node\anomaly\requirements.txt"
if (Test-Path $reqFile) {
    pip install -r $reqFile -q 2>$null
}

$anomalyLog = "$ROOT\logs\anomaly.log"
New-Item -ItemType Directory -Force -Path "$ROOT\logs" | Out-Null
$anomalyProc = Start-Process python `
    -ArgumentList "$ROOT\fog-node\anomaly\detector.py" `
    -WorkingDirectory "$ROOT\fog-node\anomaly" `
    -RedirectStandardOutput $anomalyLog `
    -NoNewWindow -PassThru
Write-Host "      ✓ Anomaly detector started (PID: $($anomalyProc.Id)) → logs\anomaly.log" -ForegroundColor Green
Start-Sleep -Seconds 3

# ── Step 3: Fog Node (Node.js) ────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/5] Starting Fog Node (→ AWS API Gateway)..." -ForegroundColor Yellow

if (-not (Test-Path "$ROOT\fog-node\node_modules")) {
    Write-Host "      Installing fog-node dependencies..." -ForegroundColor Gray
    npm install --prefix "$ROOT\fog-node" -q
}

$fogLog = "$ROOT\logs\fog-node.log"
$fogEnv = @{
    MQTT_BROKER_HOST     = "localhost"
    MQTT_BROKER_PORT     = "1883"
    CLOUD_MODE           = "aws"
    AWS_API_GATEWAY_URL  = "https://r9plrb85ll.execute-api.us-east-1.amazonaws.com/prod"
    AWS_API_KEY          = "local-dev-key"
    AGGREGATION_WINDOW_MS = "10000"
    METRICS_PORT         = "3001"
    FOG_ANOMALY_THRESHOLD = "0.20"
    ANOMALY_SERVICE_HOST = "localhost"
    ANOMALY_SERVICE_PORT = "5001"
}

$fogProcArgs = @{
    FilePath              = "node"
    ArgumentList          = "src/index.js"
    WorkingDirectory      = "$ROOT\fog-node"
    RedirectStandardOutput = $fogLog
    NoNewWindow           = $true
    PassThru              = $true
}
# Set environment for fog node process
$fogEnv.GetEnumerator() | ForEach-Object { [System.Environment]::SetEnvironmentVariable($_.Key, $_.Value, "Process") }
$fogProc = Start-Process @fogProcArgs
Write-Host "      ✓ Fog node started (PID: $($fogProc.Id)) → logs\fog-node.log" -ForegroundColor Green
Write-Host "      ✓ Metrics API: http://localhost:3001/api/metrics" -ForegroundColor Gray
Start-Sleep -Seconds 3

# ── Step 4: Sensor Simulator (Python) ────────────────────────────────────────
Write-Host ""
Write-Host "[4/5] Starting Sensor Simulator..." -ForegroundColor Yellow

$sensorLog = "$ROOT\logs\sensors.log"
$sensorProc = Start-Process python `
    -ArgumentList "$ROOT\sensors\simulator.py" `
    -WorkingDirectory "$ROOT\sensors" `
    -Environment @{MQTT_BROKER_HOST="localhost"; MQTT_BROKER_PORT="1883"; PUBLISH_RATE="1.0"} `
    -RedirectStandardOutput $sensorLog `
    -NoNewWindow -PassThru
Write-Host "      ✓ Sensors started (PID: $($sensorProc.Id)) → logs\sensors.log" -ForegroundColor Green
Write-Host "      ✓ 5 sensors publishing at 1 msg/s each" -ForegroundColor Gray

# ── Step 5: Dashboard (Vite) ──────────────────────────────────────────────────
if (-not $SkipDashboard) {
    Write-Host ""
    Write-Host "[5/5] Starting React Dashboard..." -ForegroundColor Yellow

    if (-not (Test-Path "$ROOT\dashboard\node_modules")) {
        Write-Host "      Installing dashboard dependencies..." -ForegroundColor Gray
        npm install --prefix "$ROOT\dashboard" -q
    }

    $dashProc = Start-Process npm `
        -ArgumentList "run", "dev" `
        -WorkingDirectory "$ROOT\dashboard" `
        -NoNewWindow -PassThru
    Write-Host "      ✓ Dashboard starting (PID: $($dashProc.Id))" -ForegroundColor Green
    Write-Host "      ✓ Open: http://localhost:5173" -ForegroundColor Gray
    Start-Sleep -Seconds 4
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✓ EdgeGuardian Running in AWS Mode                  ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Dashboard:    http://localhost:5173                  ║" -ForegroundColor Green
Write-Host "║  Fog Metrics:  http://localhost:3001/api/metrics      ║" -ForegroundColor Green
Write-Host "║  AWS API:      https://r9plrb85ll.execute-api.        ║" -ForegroundColor Green
Write-Host "║                us-east-1.amazonaws.com/prod           ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Data flow:  Sensors → MQTT → Fog → AWS API GW      ║" -ForegroundColor Green
Write-Host "║              → SQS → Lambda → DynamoDB               ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop all processes" -ForegroundColor Gray

# Keep script alive and wait
try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Write-Host ""
    Write-Host "Stopping all processes..." -ForegroundColor Yellow
    @($anomalyProc, $fogProc, $sensorProc, $dashProc) | Where-Object { $_ } | ForEach-Object {
        if (-not $_.HasExited) { $_.Kill() }
    }
    docker compose -f "$ROOT\docker\docker-compose.aws.yml" down
    Write-Host "Done." -ForegroundColor Green
}
