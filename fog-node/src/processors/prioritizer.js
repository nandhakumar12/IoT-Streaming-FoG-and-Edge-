/**
 * Fog Node – Event Prioritiser
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 5 of the 5-stage fog processing pipeline.
 *
 * Assigns a priority tier to each aggregated payload based on sensor-specific
 * thresholds. The tier determines urgency of cloud dispatch and alert display.
 *
 * Tiers:
 *   CRITICAL  – Immediate safety risk. Dispatched instantly (bypasses window).
 *   WARNING   – Approaching unsafe operating range. Dispatched at window flush.
 *   INFO      – Normal operation. Dispatched at window flush.
 *
 * Design note: CRITICAL events bypass the aggregation window and are forwarded
 * directly to the cloud dispatcher in real time. This ensures zero latency for
 * safety-critical events, while INFO/WARNING events benefit from aggregation.
 *
 * This dual-path approach mirrors the "tiered quality of service" pattern
 * described in Shi, W. et al. (2016), §IV-B "Computation Offloading."
 */

// ── Threshold definitions per sensor type ────────────────────────────────────
// Values derived from common industrial monitoring standards:
// - Temperature: IEC 60068-2 (thermal testing)
// - Vibration: ISO 10816-1 (machinery vibration)
// - Humidity: ASHRAE Standard 62.1
// - Pressure: IEC 61557-12
// - Power: IEC 61557-12

const THRESHOLDS = {
  temperature: {
    unit: '°C',
    CRITICAL: { above: 80.0 },
    WARNING:  { above: 60.0, below: 5.0 },
  },
  vibration: {
    unit: 'g',
    CRITICAL: { above: 9.0 },
    WARNING:  { above: 6.0 },
  },
  humidity: {
    unit: '%RH',
    CRITICAL: { above: 92.0, below: 15.0 },
    WARNING:  { above: 75.0, below: 25.0 },
  },
  pressure: {
    unit: 'hPa',
    CRITICAL: { above: 1042.0, below: 985.0 },
    WARNING:  { above: 1030.0, below: 998.0 },
  },
  power_consumption: {
    unit: 'W',
    CRITICAL: { above: 450.0 },
    WARNING:  { above: 350.0 },
  },
};

/**
 * Determine the priority tier for a single raw reading.
 * Used for real-time CRITICAL event bypass (raw payload path).
 *
 * @param {string} sensorType
 * @param {number} value
 * @returns {'CRITICAL' | 'WARNING' | 'INFO'}
 */
export function prioritiseRaw(sensorType, value) {
  const config = THRESHOLDS[sensorType];
  if (!config) return 'INFO';

  const { CRITICAL, WARNING } = config;

  if (
    (CRITICAL.above !== undefined && value > CRITICAL.above) ||
    (CRITICAL.below !== undefined && value < CRITICAL.below)
  ) return 'CRITICAL';

  if (
    (WARNING.above !== undefined && value > WARNING.above) ||
    (WARNING.below !== undefined && value < WARNING.below)
  ) return 'WARNING';

  return 'INFO';
}

/**
 * Annotate an aggregated window payload with a priority tier.
 * Uses the max value in the window to determine worst-case priority.
 *
 * @param {object} aggregated - Aggregated payload from aggregator.js
 * @returns {object} - Payload with added 'priority' and 'alert_message' fields
 */
export function prioritiseAggregated(aggregated) {
  const { type, max, min } = aggregated;
  const config = THRESHOLDS[type];

  if (!config) {
    return { ...aggregated, priority: 'INFO', alert_message: null };
  }

  const { CRITICAL, WARNING } = config;

  let priority = 'INFO';
  let alert_message = null;

  // Check max against upper bounds
  if (CRITICAL.above !== undefined && max > CRITICAL.above) {
    priority = 'CRITICAL';
    alert_message = `${type} peaked at ${max} ${config.unit} — exceeds CRITICAL threshold (${CRITICAL.above} ${config.unit})`;
  } else if (CRITICAL.below !== undefined && min < CRITICAL.below) {
    priority = 'CRITICAL';
    alert_message = `${type} dropped to ${min} ${config.unit} — below CRITICAL threshold (${CRITICAL.below} ${config.unit})`;
  } else if (WARNING.above !== undefined && max > WARNING.above) {
    priority = 'WARNING';
    alert_message = `${type} reached ${max} ${config.unit} — approaching WARNING limit (${WARNING.above} ${config.unit})`;
  } else if (WARNING.below !== undefined && min < WARNING.below) {
    priority = 'WARNING';
    alert_message = `${type} at ${min} ${config.unit} — below WARNING limit (${WARNING.below} ${config.unit})`;
  }

  return { ...aggregated, priority, alert_message };
}

/** Export thresholds for use in dashboard display. */
export { THRESHOLDS };
