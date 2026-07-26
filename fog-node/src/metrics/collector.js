/**
 * Fog Node – Metrics Collector
 * ─────────────────────────────────────────────────────────────────────────────
 * Central metrics accumulator for the fog node.
 *
 * Tracks all performance indicators that will be reported in the academic paper:
 *   - Messages received (total MQTT messages from sensors)
 *   - Messages rejected (failed schema validation)
 *   - Noise filtered (IQR outliers removed)
 *   - Messages dispatched (aggregated payloads sent to cloud)
 *   - API calls saved (reduction from aggregation)
 *   - Cloud call successes / failures
 *   - Buffer utilisation (offline resilience)
 *   - Processing latencies (per-stage)
 *
 * Exposed via GET /api/metrics on port 3001 (Express metrics server in index.js).
 */

const startTime = Date.now();

// ── Counters ─────────────────────────────────────────────────────────────────
let _received   = 0;   // Total MQTT messages received
let _rejected   = 0;   // Failed schema validation
let _noiseOut   = 0;   // IQR filter rejections
let _dispatched = 0;   // Payloads sent to cloud
let _callOk     = 0;   // Successful cloud HTTP calls
let _callFail   = 0;   // Failed cloud HTTP calls (after retries)
let _buffered   = 0;   // Messages added to offline buffer
let _dropped    = 0;   // Messages dropped (buffer full)
let _anomalies  = 0;   // Readings flagged by edge AI anomaly detector

// ── Latency tracking (rolling average, last 100 measurements) ────────────────
const latencyWindow = [];
const LATENCY_WINDOW = 100;

export const metrics = {
  // ── Increment methods ─────────────────────────────────────────────────────
  messageReceived:  () => { _received += 1; },
  messageRejected:  () => { _rejected += 1; },
  noiseFiltered:    () => { _noiseOut += 1; },
  messageDispatched:() => { _dispatched += 1; },
  cloudCallSuccess: () => { _callOk += 1; },
  cloudCallFailed:  () => { _callFail += 1; },
  messageBuffered:  () => { _buffered += 1; },
  messageDropped:   () => { _dropped += 1; },
  anomalyDetected:  () => { _anomalies += 1; },

  /**
   * Record an end-to-end processing latency measurement (ms).
   * @param {number} latencyMs
   */
  recordLatency(latencyMs) {
    latencyWindow.push(latencyMs);
    if (latencyWindow.length > LATENCY_WINDOW) latencyWindow.shift();
  },

  /**
   * Build the full metrics snapshot for the API endpoint.
   * @returns {object}
   */
  snapshot() {
    const uptimeMs    = Date.now() - startTime;
    const valid       = _received - _rejected;
    const passedNoise = valid - _noiseOut;

    // Cloud API calls saved = raw messages that would have gone direct to cloud
    // vs. the aggregated payloads that were actually dispatched
    const callsSaved  = Math.max(0, passedNoise - _dispatched);
    const reductionPct = passedNoise > 0
      ? Math.round((callsSaved / passedNoise) * 1000) / 10
      : 0;

    // Average latency
    const avgLatency = latencyWindow.length > 0
      ? Math.round((latencyWindow.reduce((a, b) => a + b, 0) / latencyWindow.length) * 100) / 100
      : 0;
    const p99Latency = latencyWindow.length > 0
      ? Math.round(latencyWindow.slice().sort((a, b) => a - b)[Math.floor(latencyWindow.length * 0.99)] * 100) / 100
      : 0;

    return {
      uptime_ms:          uptimeMs,
      uptime_human:       formatUptime(uptimeMs),
      received:           _received,
      rejected:           _rejected,
      noise_filtered:     _noiseOut,
      valid_passed:       valid,
      noise_passed:       passedNoise,
      dispatched:         _dispatched,
      cloud_calls_ok:     _callOk,
      cloud_calls_failed: _callFail,
      buffered:           _buffered,
      dropped:            _dropped,
      calls_saved:        callsSaved,
      reduction_pct:      reductionPct,
      avg_latency_ms:     avgLatency,
      p99_latency_ms:     p99Latency,
      anomalies_detected: _anomalies,
      anomaly_rate:       _received > 0 ? Math.round((_anomalies / _received) * 1000) / 10 : 0,
      throughput_msg_per_sec: uptimeMs > 0
        ? Math.round((_received / (uptimeMs / 1000)) * 10) / 10
        : 0,
    };
  },
};

function formatUptime(ms) {
  const secs  = Math.floor(ms / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ${secs % 60}s`;
}
