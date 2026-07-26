/**
 * Fog Node – Anomaly Service Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the Python Isolation Forest anomaly detection microservice
 * (running on port 5001) and returns an anomaly score for each sensor reading.
 *
 * This enables EDGE-SIDE AI inference — a key academic differentiator for the
 * fog computing architecture. Running inference at the fog node (rather than
 * the cloud) reduces round-trip latency from ~200ms to <5ms.
 *
 * Graceful degradation: if the anomaly service is unavailable, returns
 * { anomaly_score: null, is_anomaly: false } so the pipeline continues.
 */

import axios from 'axios';

const ANOMALY_HOST = process.env.ANOMALY_SERVICE_HOST || 'localhost';
const ANOMALY_PORT = parseInt(process.env.ANOMALY_SERVICE_PORT || '5001', 10);
const ANOMALY_URL  = `http://${ANOMALY_HOST}:${ANOMALY_PORT}`;
const TIMEOUT_MS   = 500;   // Must be fast — we're in the hot path

// Track service availability to avoid spamming logs when service is down
let _serviceAvailable = true;
let _lastCheckTime = 0;
const CHECK_INTERVAL_MS = 30_000;

/**
 * Score a sensor reading for anomalies.
 * @param {string} sensorType  - e.g. 'temperature'
 * @param {number} value       - The raw or aggregated value to score
 * @returns {Promise<object>}  - { anomaly_score, is_anomaly, method, ... }
 */
export async function scoreReading(sensorType, value) {
  // Check if we should skip (service was recently unreachable)
  const now = Date.now();
  if (!_serviceAvailable && (now - _lastCheckTime) < CHECK_INTERVAL_MS) {
    return { anomaly_score: null, is_anomaly: false, method: 'unavailable' };
  }

  try {
    const response = await axios.post(
      `${ANOMALY_URL}/score`,
      { sensor_type: sensorType, value },
      { timeout: TIMEOUT_MS }
    );
    _serviceAvailable = true;
    return response.data;

  } catch (err) {
    if (_serviceAvailable) {
      console.warn(`[AnomalyClient] Service unavailable at ${ANOMALY_URL} — gracefully degrading`);
      _serviceAvailable = false;
      _lastCheckTime = now;
    }
    return { anomaly_score: null, is_anomaly: false, method: 'unavailable' };
  }
}

/**
 * Get health and stats from the anomaly service.
 * Used by the metrics endpoint.
 */
export async function getAnomalyStats() {
  try {
    const [health, stats] = await Promise.all([
      axios.get(`${ANOMALY_URL}/health`, { timeout: 1000 }),
      axios.get(`${ANOMALY_URL}/stats`,  { timeout: 1000 }),
    ]);
    return {
      available: true,
      sklearn:   health.data.sklearn,
      models:    health.data.models,
      uptime_s:  health.data.uptime_s,
      per_sensor: stats.data.per_sensor_stats,
    };
  } catch {
    return { available: false };
  }
}
