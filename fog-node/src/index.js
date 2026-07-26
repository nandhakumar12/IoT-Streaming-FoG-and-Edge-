/**
 * EdgeGuardian – Fog Node Entry Point
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the complete 5-stage fog processing pipeline:
 *
 *   MQTT Receive → [1] Validate → [2] Noise Filter → [3] Aggregate
 *              ↘ CRITICAL bypass ──────────────────────────────────────↗
 *                                                           [4] Adaptive Sample
 *                                                           [5] Prioritise
 *                                                           → Dispatch to Cloud
 *
 * Exposes a REST metrics server on port 3001 for the React dashboard.
 *
 * Environment variables (see .env.example):
 *   MQTT_BROKER_HOST, MQTT_BROKER_PORT
 *   CLOUD_MODE, CLOUD_ENDPOINT, CLOUD_API_KEY
 *   AGGREGATION_WINDOW_MS, METRICS_PORT
 */

import 'dotenv/config';
import mqtt from 'mqtt';
import express from 'express';

import { parseAndValidate }       from './processors/validator.js';
import { filterNoise }            from './processors/noiseFilter.js';
import { addReading, onAggregate } from './processors/aggregator.js';
import { recordReading }          from './processors/adaptiveSampler.js';
import { prioritiseRaw, prioritiseAggregated } from './processors/prioritizer.js';
import { dispatch, getBufferStats } from './cloud/dispatcher.js';
import { metrics }                from './metrics/collector.js';
import { setWindowDuration }      from './utils/timer.js';
import { scoreReading, getAnomalyStats } from './anomaly/client.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const MQTT_HOST    = process.env.MQTT_BROKER_HOST || 'localhost';
const MQTT_PORT    = parseInt(process.env.MQTT_BROKER_PORT || '1883', 10);
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '3001', 10);
const WINDOW_MS    = parseInt(process.env.AGGREGATION_WINDOW_MS || '10000', 10);

// ── MQTT Client ───────────────────────────────────────────────────────────────
console.log(`[FogNode] Connecting to MQTT broker at ${MQTT_HOST}:${MQTT_PORT}…`);

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: `edgeguardian-fog-${process.pid}`,
  keepalive: 60,
  reconnectPeriod: 2000,
  connectTimeout: 10_000,
});

mqttClient.on('connect', () => {
  console.log('[FogNode] ✓ Connected to MQTT broker');
  // Subscribe to all sensor topics: sensors/{type}/{sensor_id}
  mqttClient.subscribe('sensors/#', { qos: 1 }, (err) => {
    if (err) console.error('[FogNode] Subscription error:', err);
    else console.log('[FogNode] Subscribed to sensors/#');
  });
});

mqttClient.on('reconnect', () => console.warn('[FogNode] Reconnecting to MQTT…'));
mqttClient.on('error',     (err) => console.error('[FogNode] MQTT error:', err.message));

// ── Main message handler ───────────────────────────────────────────────────────
mqttClient.on('message', async (topic, message) => {
  const receiveTime = Date.now();
  metrics.messageReceived();

  // ── Stage 1: Validate ──────────────────────────────────────────────────────
  const { valid, errors, payload } = parseAndValidate(message);
  if (!valid) {
    metrics.messageRejected();
    console.warn(`[Validator] ✗ Rejected (${topic}): ${errors.join(', ')}`);
    return;
  }

  const { sensor_id, type, value } = payload;

  // ── Stage 2: Noise Filter ─────────────────────────────────────────────────
  const { isNoise } = filterNoise(sensor_id, value);
  if (isNoise) {
    metrics.noiseFiltered();
    // Note: noise readings are still tracked for anomaly rate calculation
    recordReading(type, true);
    console.debug(`[NoiseFilter] Outlier detected: ${type} = ${value}`);
    return;  // Do not aggregate noise
  }

  // ── Anomaly scoring (edge AI) ─────────────────────────────────────────────
  const anomalyResult = await scoreReading(type, value);
  if (anomalyResult.is_anomaly) {
    metrics.anomalyDetected();
    console.debug(`[Anomaly] 🔺 ${type} = ${value} | score=${anomalyResult.anomaly_score}`);
  }

  // ── CRITICAL bypass: dispatch raw reading immediately ─────────────────────
  const rawPriority = prioritiseRaw(type, value);
  if (rawPriority === 'CRITICAL') {
    const criticalPayload = {
      ...payload,
      priority: 'CRITICAL',
      alert_message: `CRITICAL: ${type} = ${value} ${payload.unit}`,
      _bypass: true,
      _aggregated: false,
      anomaly_score: anomalyResult.anomaly_score,
      is_anomaly:    anomalyResult.is_anomaly,
    };
    metrics.messageDispatched();
    recordReading(type, true);
    await dispatch(criticalPayload);
    // Fall through to also add to aggregation window for statistics
  }

  // ── Stage 3: Aggregate ────────────────────────────────────────────────────
  addReading(payload);

  // ── Stage 4: Record for adaptive sampler ─────────────────────────────────
  recordReading(type, rawPriority !== 'INFO');

  // ── Record latency ─────────────────────────────────────────────────────────
  metrics.recordLatency(Date.now() - receiveTime);
});

// ── Aggregation output handler ────────────────────────────────────────────────
// Called by aggregator.js when each window closes (every WINDOW_MS)
onAggregate(async (aggregated) => {
  // ── Stage 5: Prioritise aggregated payload ────────────────────────────────
  const prioritised = prioritiseAggregated(aggregated);

  // Skip dispatch for INFO payloads with very few readings
  if (prioritised.count < 1) return;

  // ── Score the aggregated mean for anomalies ───────────────────────────────
  const scoreValue = prioritised.mean ?? prioritised.value;
  if (scoreValue != null) {
    const anomalyResult = await scoreReading(prioritised.type, scoreValue);
    prioritised.anomaly_score = anomalyResult.anomaly_score;
    prioritised.is_anomaly    = anomalyResult.is_anomaly;
    if (anomalyResult.is_anomaly) metrics.anomalyDetected();
  }

  metrics.messageDispatched();

  // ── Dispatch to cloud ─────────────────────────────────────────────────────
  await dispatch(prioritised);
});

// ── Start aggregation timer ────────────────────────────────────────────────────
setWindowDuration(WINDOW_MS);

// ── Metrics REST API ───────────────────────────────────────────────────────────
// Exposes real-time fog node statistics to the React dashboard
const app = express();

// CORS – allow dashboard (localhost:5173) to poll this endpoint
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.get('/api/metrics', async (req, res) => {
  const snapshot = metrics.snapshot();
  const bufferStats = getBufferStats();
  const anomalyStats = await getAnomalyStats();
  res.json({ ...snapshot, ...bufferStats, anomaly: anomalyStats, timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime_ms: Date.now() - Date.now() });
});

app.listen(METRICS_PORT, () => {
  console.log(`[FogNode] Metrics API listening on http://localhost:${METRICS_PORT}/api/metrics`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal) {
  console.log(`\n[FogNode] ${signal} received — shutting down`);
  console.log('[FogNode] Final metrics:', metrics.snapshot());
  mqttClient.end(true, () => process.exit(0));
}
