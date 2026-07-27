/**
 * Fog Node – EdgeGuardian
 *
 * Entry point for the five-stage processing pipeline. Each incoming MQTT
 * message passes through validation, IQR noise filtering, temporal
 * aggregation, adaptive sampling, and priority classification before
 * being forwarded to the backend via Kafka or HTTP.
 *
 * CRITICAL readings bypass aggregation and are dispatched immediately
 * to minimise alert latency.
 *
 * Configuration (see .env.example):
 *   MQTT_BROKER_HOST, MQTT_BROKER_PORT, AGGREGATION_WINDOW_MS, METRICS_PORT
 */

import 'dotenv/config';
import mqtt from 'mqtt';
import express from 'express';

import { parseAndValidate }                        from './processors/validator.js';
import { filterNoise }                             from './processors/noiseFilter.js';
import { addReading, onAggregate }                 from './processors/aggregator.js';
import { recordReading }                           from './processors/adaptiveSampler.js';
import { prioritiseRaw, prioritiseAggregated }     from './processors/prioritizer.js';
import { dispatch, getBufferStats }                from './cloud/dispatcher.js';
import { metrics }                                 from './metrics/collector.js';
import { setWindowDuration }                       from './utils/timer.js';
import { scoreReading, getAnomalyStats }           from './anomaly/client.js';

const MQTT_HOST    = process.env.MQTT_BROKER_HOST       || 'localhost';
const MQTT_PORT    = parseInt(process.env.MQTT_BROKER_PORT  || '1883', 10);
const METRICS_PORT = parseInt(process.env.METRICS_PORT      || '3001', 10);
const WINDOW_MS    = parseInt(process.env.AGGREGATION_WINDOW_MS || '10000', 10);

// Connect to the MQTT broker and subscribe to all sensor topics
console.log(`[FogNode] Connecting to MQTT broker at ${MQTT_HOST}:${MQTT_PORT}`);

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: `edgeguardian-fog-${process.pid}`,
  keepalive: 60,
  reconnectPeriod: 2000,
  connectTimeout: 10_000,
});

mqttClient.on('connect', () => {
  console.log('[FogNode] Connected to MQTT broker');
  mqttClient.subscribe('sensors/#', { qos: 1 }, (err) => {
    if (err) console.error('[FogNode] Subscription failed:', err);
    else     console.log('[FogNode] Subscribed to sensors/#');
  });
});

mqttClient.on('reconnect', () => console.warn('[FogNode] Reconnecting to MQTT broker…'));
mqttClient.on('error',     (err) => console.error('[FogNode] MQTT error:', err.message));

// Main pipeline handler — runs for every incoming sensor message
mqttClient.on('message', async (topic, message) => {
  const receiveTime = Date.now();
  metrics.messageReceived();

  // Stage 1 – validate schema
  const { valid, errors, payload } = parseAndValidate(message);
  if (!valid) {
    metrics.messageRejected();
    console.warn(`[Validator] Rejected (${topic}): ${errors.join(', ')}`);
    return;
  }

  const { sensor_id, type, value } = payload;

  // Stage 2 – IQR noise filter
  const { isNoise } = filterNoise(sensor_id, value);
  if (isNoise) {
    metrics.noiseFiltered();
    recordReading(type, true);  // still counted for adaptive rate tracking
    return;
  }

  // Run the Isolation Forest scorer for this reading
  const anomalyResult = await scoreReading(type, value);
  if (anomalyResult.is_anomaly) {
    metrics.anomalyDetected();
  }

  // CRITICAL bypass – dispatch raw reading immediately without waiting for the window
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
    // still falls through so the reading is included in the aggregation window
  }

  // Stage 3 – add to current aggregation window
  addReading(payload);

  // Stage 4 – update adaptive sampler with whether this was an anomaly
  recordReading(type, rawPriority !== 'INFO');

  metrics.recordLatency(Date.now() - receiveTime);
});

// Stage 5 – fires when each aggregation window closes
onAggregate(async (aggregated) => {
  const prioritised = prioritiseAggregated(aggregated);

  if (prioritised.count < 1) return;

  // Score the window mean for anomaly detection
  const scoreValue = prioritised.mean ?? prioritised.value;
  if (scoreValue != null) {
    const anomalyResult = await scoreReading(prioritised.type, scoreValue);
    prioritised.anomaly_score = anomalyResult.anomaly_score;
    prioritised.is_anomaly    = anomalyResult.is_anomaly;
    if (anomalyResult.is_anomaly) metrics.anomalyDetected();
  }

  metrics.messageDispatched();
  await dispatch(prioritised);
});

setWindowDuration(WINDOW_MS);

// Metrics REST API – polled by the React dashboard at 2 Hz
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.get('/api/metrics', async (req, res) => {
  const snapshot    = metrics.snapshot();
  const bufferStats = getBufferStats();
  const anomalyStats = await getAnomalyStats();
  res.json({ ...snapshot, ...bufferStats, anomaly: anomalyStats, timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime_ms: Date.now() - Date.now() });
});

app.listen(METRICS_PORT, () => {
  console.log(`[FogNode] Metrics API on http://localhost:${METRICS_PORT}/api/metrics`);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal) {
  console.log(`[FogNode] ${signal} — shutting down`);
  console.log('[FogNode] Final metrics:', metrics.snapshot());
  mqttClient.end(true, () => process.exit(0));
}
