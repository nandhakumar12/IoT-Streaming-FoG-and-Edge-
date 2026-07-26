/**
 * Fog Node – Noise Filter (IQR Method)
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 2 of the 5-stage fog processing pipeline.
 *
 * Removes statistical outliers using the Interquartile Range (IQR) method.
 * Each sensor maintains its own sliding window of the last N readings.
 * Readings that fall outside [Q1 - 1.5×IQR, Q3 + 1.5×IQR] are flagged
 * as noise and excluded from aggregation.
 *
 * Why IQR over z-score?
 * IQR is non-parametric: it does not assume a Gaussian distribution.
 * Industrial sensor data often has heavy tails and asymmetric distributions,
 * making IQR more robust than z-score methods [Tukey, 1977].
 *
 * Academic reference: Tukey, J.W. (1977) "Exploratory Data Analysis"
 * Addison-Wesley. Section 2C: Boxplots and Outliers.
 */

// Sliding window size per sensor — 30 readings (30 seconds at 1 Hz)
const WINDOW_SIZE = 30;

// IQR multiplier (1.5 = Tukey's standard "inner fence")
const IQR_MULTIPLIER = 1.5;

// Map: sensor_id → circular buffer of recent values
const windows = new Map();

/**
 * Sort an array of numbers in ascending order.
 * @param {number[]} arr
 * @returns {number[]}
 */
function sortAsc(arr) {
  return [...arr].sort((a, b) => a - b);
}

/**
 * Calculate Q1 (25th percentile) and Q3 (75th percentile).
 * Uses linear interpolation for non-integer positions.
 *
 * @param {number[]} sorted - Sorted array of values
 * @returns {{ q1: number, q3: number, iqr: number }}
 */
function quartiles(sorted) {
  const n = sorted.length;
  if (n < 4) return { q1: -Infinity, q3: Infinity, iqr: Infinity };

  const q1Pos = (n + 1) * 0.25;
  const q3Pos = (n + 1) * 0.75;

  const q1 = interpolate(sorted, q1Pos);
  const q3 = interpolate(sorted, q3Pos);
  return { q1, q3, iqr: q3 - q1 };
}

function interpolate(arr, pos) {
  const lower = Math.floor(pos) - 1;
  const upper = Math.ceil(pos) - 1;
  const frac = pos - Math.floor(pos);
  return arr[lower] + frac * (arr[upper] - arr[lower] || 0);
}

/**
 * Add a new reading to the sensor's window and determine if it is noise.
 *
 * @param {string} sensorId - Unique sensor identifier
 * @param {number} value     - New reading value
 * @returns {{ isNoise: boolean, lowerBound: number, upperBound: number }}
 */
export function filterNoise(sensorId, value) {
  // Initialise window for new sensor
  if (!windows.has(sensorId)) {
    windows.set(sensorId, []);
  }

  const window = windows.get(sensorId);

  // Calculate bounds from existing window (before adding new value)
  let isNoise = false;
  let lowerBound = -Infinity;
  let upperBound = Infinity;

  if (window.length >= 8) {  // Need at least 8 readings for reliable IQR
    const sorted = sortAsc(window);
    const { q1, q3, iqr } = quartiles(sorted);
    lowerBound = q1 - IQR_MULTIPLIER * iqr;
    upperBound = q3 + IQR_MULTIPLIER * iqr;
    isNoise = value < lowerBound || value > upperBound;
  }

  // Add value to window (maintain fixed size)
  window.push(value);
  if (window.length > WINDOW_SIZE) {
    window.shift();  // Remove oldest reading
  }

  return { isNoise, lowerBound, upperBound };
}

/**
 * Get current window statistics for a sensor (used by metrics collector).
 *
 * @param {string} sensorId
 * @returns {{ count: number, mean: number|null }}
 */
export function getWindowStats(sensorId) {
  const window = windows.get(sensorId);
  if (!window || window.length === 0) return { count: 0, mean: null };
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  return { count: window.length, mean: Math.round(mean * 100) / 100 };
}
