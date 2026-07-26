/**
 * Fog Node – Adaptive Sampler
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 4 of the 5-stage fog processing pipeline.
 *
 * Dynamically adjusts the aggregation window duration based on the anomaly
 * detection rate within the current window. If anomalies are detected
 * frequently (>threshold), the window is shortened to dispatch data to the
 * cloud more urgently. This is the core intelligent behaviour of the fog node.
 *
 * Algorithm:
 *   anomaly_rate = anomalies_in_window / total_readings_in_window
 *   if anomaly_rate > HIGH_THRESHOLD  → window = MIN_WINDOW (urgent)
 *   if anomaly_rate > LOW_THRESHOLD   → window = MID_WINDOW (elevated)
 *   else                              → window = BASE_WINDOW (normal)
 *
 * This implements the concept of "context-aware data collection" described in:
 * Shi, W. et al. (2016). "Edge Computing: Vision and Challenges." IEEE IoT J.
 *
 * Why this matters academically: Standard IoT architectures use fixed sampling
 * rates, causing either data loss (too slow) or cloud overload (too fast).
 * Adaptive sampling optimises the throughput-cost trade-off in real time.
 */

import { setWindowDuration } from '../utils/timer.js';

// ── Thresholds ────────────────────────────────────────────────────────────────
const HIGH_ANOMALY_THRESHOLD = 0.20;  // 20% anomaly rate → urgent mode
const LOW_ANOMALY_THRESHOLD  = 0.05;  // 5% anomaly rate  → elevated mode

// Window durations (ms) for each mode
const BASE_WINDOW_MS = parseInt(process.env.AGGREGATION_WINDOW_MS || '10000', 10);
const MID_WINDOW_MS  = Math.round(BASE_WINDOW_MS * 0.5);   // 5s
const MIN_WINDOW_MS  = Math.round(BASE_WINDOW_MS * 0.25);  // 2.5s

// Per-sensor-type anomaly tracking
const anomalyTrackers = new Map();

/**
 * Record whether a reading was anomalous for a sensor type.
 * Used to compute the anomaly rate at the end of each window.
 *
 * @param {string} sensorType
 * @param {boolean} isAnomaly
 */
export function recordReading(sensorType, isAnomaly) {
  if (!anomalyTrackers.has(sensorType)) {
    anomalyTrackers.set(sensorType, { total: 0, anomalies: 0 });
  }
  const tracker = anomalyTrackers.get(sensorType);
  tracker.total += 1;
  if (isAnomaly) tracker.anomalies += 1;
}

/**
 * Evaluate anomaly rates across all sensor types and adjust the window
 * duration accordingly. Called at the end of each aggregation window flush.
 *
 * @returns {{ newWindowMs: number, maxAnomalyRate: number, mode: string }}
 */
export function evaluateAndAdapt() {
  let maxRate = 0;

  for (const [, tracker] of anomalyTrackers.entries()) {
    if (tracker.total > 0) {
      const rate = tracker.anomalies / tracker.total;
      if (rate > maxRate) maxRate = rate;
    }
  }

  // Reset trackers for next window
  anomalyTrackers.clear();

  let newWindowMs;
  let mode;

  if (maxRate >= HIGH_ANOMALY_THRESHOLD) {
    newWindowMs = MIN_WINDOW_MS;
    mode = 'URGENT';
  } else if (maxRate >= LOW_ANOMALY_THRESHOLD) {
    newWindowMs = MID_WINDOW_MS;
    mode = 'ELEVATED';
  } else {
    newWindowMs = BASE_WINDOW_MS;
    mode = 'NORMAL';
  }

  // Apply the new window duration to the aggregation timer
  setWindowDuration(newWindowMs);

  return { newWindowMs, maxAnomalyRate: Math.round(maxRate * 1000) / 10, mode };
}

/** Get the current anomaly rate for a sensor type (for metrics). */
export function getAnomalyRate(sensorType) {
  const tracker = anomalyTrackers.get(sensorType);
  if (!tracker || tracker.total === 0) return 0;
  return Math.round((tracker.anomalies / tracker.total) * 1000) / 10;
}
