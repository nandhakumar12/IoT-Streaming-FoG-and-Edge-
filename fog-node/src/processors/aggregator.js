/**
 * Fog Node – Time-Window Aggregator
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 3 of the 5-stage fog processing pipeline.
 *
 * Accumulates validated, denoised readings over a configurable time window
 * (default 10 seconds), then emits a single aggregated payload containing:
 *   - mean, min, max, count, std_dev
 *
 * This is the primary mechanism for cloud API call reduction:
 * Instead of forwarding every raw reading (potentially 10 msg/s × 5 sensors
 * = 50 API calls per second), the aggregator reduces this to 5 calls per window
 * (one per sensor type), achieving ~80% call reduction at 1 Hz sensor rate.
 *
 * Design pattern: Tumbling Window Aggregation
 * Each window is non-overlapping. When the window closes, accumulated data
 * is emitted and the window resets. This is simpler and more memory-efficient
 * than sliding windows for cloud dispatch purposes.
 *
 * Reference: Akidau, T. et al. (2015). "The Dataflow Model." VLDB Endowment.
 */

// Window duration in milliseconds (configurable via environment)
const WINDOW_MS = parseInt(process.env.AGGREGATION_WINDOW_MS || '10000', 10);

/**
 * Per-sensor window state.
 * Key: sensorType (string)
 * Value: { readings: number[], firstTimestamp: string, lastTimestamp: string }
 */
const windows = new Map();

/** Registered callbacks for when a window closes. */
const onWindowClose = [];

/**
 * Register a callback to be called when an aggregation window closes.
 * The callback receives the aggregated payload object.
 *
 * @param {function} callback - fn(aggregatedPayload: object) => void
 */
export function onAggregate(callback) {
  onWindowClose.push(callback);
}

/**
 * Add a validated, denoised reading to its sensor type's window.
 * Readings from all sensor IDs of the same type are pooled together.
 *
 * @param {object} payload - Validated sensor payload
 * @param {string} payload.type
 * @param {string} payload.sensor_id
 * @param {number} payload.value
 * @param {string} payload.unit
 * @param {string} payload.timestamp
 */
export function addReading(payload) {
  const { type, sensor_id, value, unit, timestamp } = payload;

  if (!windows.has(type)) {
    windows.set(type, {
      readings: [],
      sensorIds: new Set(),
      firstTimestamp: timestamp,
      lastTimestamp: timestamp,
      unit,
    });
  }

  const win = windows.get(type);
  win.readings.push(value);
  win.sensorIds.add(sensor_id);
  win.lastTimestamp = timestamp;
}

/**
 * Compute statistics for an array of numbers.
 * @param {number[]} values
 * @returns {{ mean: number, min: number, max: number, std_dev: number, count: number }}
 */
function computeStats(values) {
  const count = values.length;
  if (count === 0) return { mean: 0, min: 0, max: 0, std_dev: 0, count: 0 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;
  const std_dev = Math.sqrt(variance);

  return {
    mean: Math.round(mean * 1000) / 1000,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    std_dev: Math.round(std_dev * 1000) / 1000,
    count,
  };
}

/**
 * Close all open windows, emit aggregated payloads, and reset.
 * Called on a fixed timer by the main index.js.
 */
export function flushWindows() {
  const flushedAt = new Date().toISOString();

  for (const [sensorType, win] of windows.entries()) {
    if (win.readings.length === 0) continue;

    const stats = computeStats(win.readings);
    const aggregatedPayload = {
      type: sensorType,
      unit: win.unit,
      sensor_ids: [...win.sensorIds],
      window_ms: WINDOW_MS,
      first_timestamp: win.firstTimestamp,
      last_timestamp: win.lastTimestamp,
      flushed_at: flushedAt,
      ...stats,            // spread: mean, min, max, std_dev, count
      _aggregated: true,   // flag for downstream processors
    };

    // Notify all registered callbacks
    for (const cb of onWindowClose) {
      cb(aggregatedPayload);
    }
  }

  // Reset all windows
  windows.clear();
}

/**
 * Start the aggregation timer. Must be called once at startup.
 */
export function startAggregationTimer() {
  setInterval(flushWindows, WINDOW_MS);
  console.log(`[Aggregator] Tumbling window set to ${WINDOW_MS}ms`);
}

/** Returns how many sensor types currently have open windows. */
export function getActiveWindowCount() {
  return windows.size;
}
