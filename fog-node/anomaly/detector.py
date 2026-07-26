"""
EdgeGuardian – Fog-Side Anomaly Detector
=========================================
A lightweight HTTP microservice that provides real-time anomaly scoring
at the fog layer using scikit-learn's Isolation Forest algorithm.

Academic rationale:
  Running inference AT the fog node (rather than the cloud) embodies the
  core fog computing principle: "pushing computation towards the data source
  to reduce latency and bandwidth" [Bonomi et al., 2012].

  Isolation Forest was chosen because:
    1. Unsupervised — no labelled anomaly data required (realistic for IoT)
    2. O(n log n) training, O(1) scoring — suitable for resource-constrained nodes
    3. Robust to high-dimensional data [Liu et al., 2008, IEEE ICDM]

API:
  POST /score   { "sensor_type": str, "value": float } → { "score": float, "is_anomaly": bool }
  POST /train   { "sensor_type": str, "values": [float] } → { "trained": true }
  GET  /health  → { "status": "ok", "models": [...] }
  GET  /stats   → { "per_sensor_stats": { ... } }

Usage (Docker):
  python detector.py          # listens on 0.0.0.0:5001
  ANOMALY_PORT=5002 python detector.py
"""

import json
import logging
import math
import os
import random
import statistics
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Optional sklearn (gracefully degrade if not installed) ───────────────────
try:
    from sklearn.ensemble import IsolationForest
    import numpy as np
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logging.warning("scikit-learn not available — using statistical fallback (Z-score)")

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [AnomalyDetector] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

PORT = int(os.getenv("ANOMALY_PORT", "5001"))
TRAIN_MIN_SAMPLES = int(os.getenv("ANOMALY_TRAIN_MIN", "30"))   # min readings before training
WINDOW_SIZE        = int(os.getenv("ANOMALY_WINDOW", "200"))    # sliding window for online learning

# Normal operating ranges (used for warm-start synthetic training data)
SENSOR_NORMAL_RANGES = {
    "temperature":       (15.0,  40.0),
    "vibration":         (0.1,   2.0),
    "humidity":          (35.0,  65.0),
    "pressure":          (1005.0, 1025.0),
    "power_consumption": (120.0, 280.0),
}

ANOMALY_THRESHOLD = float(os.getenv("ANOMALY_THRESHOLD", "-0.1"))  # IF score below this = anomaly


# ── Detector State ────────────────────────────────────────────────────────────
class SensorDetector:
    """Per-sensor anomaly detector with online learning."""

    def __init__(self, sensor_type: str):
        self.sensor_type = sensor_type
        self.model = None
        self.window: deque = deque(maxlen=WINDOW_SIZE)
        self.total_scored = 0
        self.total_anomalies = 0
        self.last_trained_at = None
        self.lock = threading.Lock()

        # Pre-train on synthetic normal data so we can score from the start
        lo, hi = SENSOR_NORMAL_RANGES.get(sensor_type, (0.0, 100.0))
        synthetic = [lo + random.random() * (hi - lo) for _ in range(TRAIN_MIN_SAMPLES)]
        self._train(synthetic)

    def _train(self, values: list):
        """(Re-)train the Isolation Forest on the given values."""
        if SKLEARN_AVAILABLE and len(values) >= TRAIN_MIN_SAMPLES:
            X = np.array(values).reshape(-1, 1)
            self.model = IsolationForest(
                n_estimators=100,
                contamination=0.05,   # assume ≤5% anomalies in training data
                random_state=42,
            )
            self.model.fit(X)
            self.last_trained_at = time.time()
            log.info(f"[{self.sensor_type}] Isolation Forest trained on {len(values)} samples")
        else:
            self.model = None  # use statistical fallback

    def add_reading(self, value: float):
        """Add a reading to the sliding window and periodically retrain."""
        with self.lock:
            self.window.append(value)
            # Retrain every 50 new readings once we have enough data
            if (len(self.window) >= TRAIN_MIN_SAMPLES and
                    len(self.window) % 50 == 0):
                self._train(list(self.window))

    def score(self, value: float) -> dict:
        """
        Score a reading. Returns:
          - anomaly_score: float  (0.0=normal, 1.0=certain anomaly)
          - raw_if_score:  float  (raw Isolation Forest score, negative = anomaly)
          - is_anomaly:    bool
          - method:        str    ('isolation_forest' | 'zscore')
        """
        with self.lock:
            self.total_scored += 1

            if self.model is not None and SKLEARN_AVAILABLE:
                # Isolation Forest score
                X = np.array([[value]])
                raw_score = float(self.model.score_samples(X)[0])
                # Normalize to [0, 1]: more negative = more anomalous
                # IF scores typically range from -0.5 to 0.0 for normal data
                normalized = max(0.0, min(1.0, (-raw_score - 0.0) / 0.5))
                is_anomaly = raw_score < ANOMALY_THRESHOLD
                method = "isolation_forest"
            else:
                # Statistical fallback: Z-score
                if len(self.window) >= 10:
                    mean = statistics.mean(self.window)
                    stdev = statistics.stdev(self.window) or 1.0
                    z = abs((value - mean) / stdev)
                    normalized = min(1.0, z / 4.0)   # z>4 → score=1.0
                    is_anomaly = z > 3.0
                else:
                    normalized = 0.0
                    is_anomaly = False
                raw_score = None
                method = "zscore"

            if is_anomaly:
                self.total_anomalies += 1

            return {
                "anomaly_score":  round(normalized, 4),
                "raw_if_score":   round(raw_score, 4) if raw_score is not None else None,
                "is_anomaly":     is_anomaly,
                "method":         method,
                "window_size":    len(self.window),
                "anomaly_rate":   round(self.total_anomalies / max(1, self.total_scored), 4),
            }

    def stats(self) -> dict:
        with self.lock:
            vals = list(self.window)
            return {
                "sensor_type":    self.sensor_type,
                "window_size":    len(vals),
                "total_scored":   self.total_scored,
                "total_anomalies":self.total_anomalies,
                "anomaly_rate":   round(self.total_anomalies / max(1, self.total_scored), 4),
                "model":          "isolation_forest" if (self.model and SKLEARN_AVAILABLE) else "zscore",
                "last_trained_at": self.last_trained_at,
                "mean":           round(statistics.mean(vals), 3) if vals else None,
                "stdev":          round(statistics.stdev(vals), 3) if len(vals) > 1 else None,
            }


# ── Global detector registry ──────────────────────────────────────────────────
_detectors: dict[str, SensorDetector] = {}
_detectors_lock = threading.Lock()


def get_detector(sensor_type: str) -> SensorDetector:
    with _detectors_lock:
        if sensor_type not in _detectors:
            _detectors[sensor_type] = SensorDetector(sensor_type)
        return _detectors[sensor_type]


# ── HTTP Server ───────────────────────────────────────────────────────────────
class AnomalyHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # Suppress per-request access logs

    def _respond(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def do_GET(self):
        if self.path == "/health":
            with _detectors_lock:
                models = list(_detectors.keys())
            self._respond(200, {
                "status": "ok",
                "sklearn": SKLEARN_AVAILABLE,
                "models": models,
                "uptime_s": round(time.time() - _start_time, 1),
            })

        elif self.path == "/stats":
            with _detectors_lock:
                stats = {k: v.stats() for k, v in _detectors.items()}
            self._respond(200, {"per_sensor_stats": stats})

        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self):
        try:
            body = self._read_body()
        except (json.JSONDecodeError, ValueError) as e:
            self._respond(400, {"error": f"Invalid JSON: {e}"})
            return

        if self.path == "/score":
            sensor_type = body.get("sensor_type")
            value       = body.get("value")

            if not sensor_type or value is None:
                self._respond(400, {"error": "Missing sensor_type or value"})
                return

            try:
                value = float(value)
            except (TypeError, ValueError):
                self._respond(400, {"error": "value must be a number"})
                return

            detector = get_detector(sensor_type)
            detector.add_reading(value)
            result = detector.score(value)
            self._respond(200, result)

        elif self.path == "/train":
            sensor_type = body.get("sensor_type")
            values      = body.get("values", [])

            if not sensor_type or not values:
                self._respond(400, {"error": "Missing sensor_type or values"})
                return

            detector = get_detector(sensor_type)
            detector._train([float(v) for v in values])
            self._respond(200, {"trained": True, "samples": len(values)})

        else:
            self._respond(404, {"error": "Not found"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


# ── Entry point ───────────────────────────────────────────────────────────────
_start_time = time.time()

if __name__ == "__main__":
    # Pre-create detectors for all known sensor types
    for stype in SENSOR_NORMAL_RANGES:
        get_detector(stype)

    server = HTTPServer(("0.0.0.0", PORT), AnomalyHandler)
    mode = "Isolation Forest" if SKLEARN_AVAILABLE else "Z-score fallback"
    log.info(f"Anomaly detector started on port {PORT} — mode: {mode}")
    log.info(f"Endpoints: POST /score, POST /train, GET /health, GET /stats")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Anomaly detector stopped")
        server.server_close()
