/**
 * Fog Node – Cloud Dispatcher (with Kafka support)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends prioritised, aggregated payloads to the cloud backend.
 *
 * Supports three modes (controlled by CLOUD_MODE env var):
 *   'local'  → Posts directly to local Express backend (HTTP POST)
 *   'kafka'  → Produces to Kafka topic 'fog.readings' (recommended)
 *   'aws'    → Posts to AWS API Gateway REST endpoint
 *
 * Kafka mode is the production-grade approach:
 *   - Back-pressure: Kafka absorbs burst traffic (e.g. 50 sensors simultaneously)
 *   - Fault tolerance: messages persist on disk if backend is temporarily down
 *   - Replay: consumer can reprocess messages from any offset
 *   - Scalability: multiple backend consumers can process in parallel
 *   [Apache Kafka Documentation; Kreps et al., 2011]
 *
 * Features:
 *   - Automatic retry with exponential backoff (HTTP mode)
 *   - In-memory buffer for cloud outage scenarios (offline resilience)
 *   - Metrics tracking: calls made, calls failed, messages buffered
 */

import axios from 'axios';
import { Kafka, Partitioners } from 'kafkajs';
import { metrics } from '../metrics/collector.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const CLOUD_MODE     = process.env.CLOUD_MODE || 'local';
const CLOUD_ENDPOINT = process.env.CLOUD_ENDPOINT || 'http://localhost:3000';
const CLOUD_API_KEY  = process.env.CLOUD_API_KEY || 'local-dev-key';
const AWS_API_URL    = process.env.AWS_API_GATEWAY_URL || '';
const AWS_API_KEY    = process.env.AWS_API_KEY || '';
const KAFKA_BROKER   = process.env.KAFKA_BROKER || 'localhost:9092';
const KAFKA_TOPIC    = process.env.KAFKA_TOPIC || 'fog.readings';
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;
const BUFFER_LIMIT   = 500;  // Max messages to buffer during outage

// ── State ─────────────────────────────────────────────────────────────────────
const offlineBuffer = [];
let isReplaying = false;

// ── Kafka Producer ────────────────────────────────────────────────────────────
let kafkaProducer = null;

async function getKafkaProducer() {
  if (kafkaProducer) return kafkaProducer;

  const kafka = new Kafka({
    clientId: 'edgeguardian-fog-node',
    brokers: [KAFKA_BROKER],
    retry: {
      initialRetryTime: 300,
      retries: 8,
    },
  });

  kafkaProducer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
    allowAutoTopicCreation: true,
  });

  await kafkaProducer.connect();
  console.log(`[Dispatcher] ✓ Connected to Kafka broker at ${KAFKA_BROKER}`);
  console.log(`[Dispatcher] ✓ Producing to topic: ${KAFKA_TOPIC}`);
  return kafkaProducer;
}

// ── Kafka dispatch ────────────────────────────────────────────────────────────
async function dispatchToKafka(payload) {
  const producer = await getKafkaProducer();
  await producer.send({
    topic: KAFKA_TOPIC,
    messages: [{
      key:   payload.type,                          // partition by sensor type
      value: JSON.stringify(payload),
      headers: {
        priority:  payload.priority || 'INFO',
        sensor:    payload.type,
        timestamp: new Date().toISOString(),
      },
    }],
  });
  metrics.cloudCallSuccess();
}

// ── HTTP dispatch helpers ─────────────────────────────────────────────────────
function getEndpointConfig() {
  if (CLOUD_MODE === 'aws') {
    return {
      url: `${AWS_API_URL}/ingest`,
      headers: { 'Content-Type': 'application/json', 'x-api-key': AWS_API_KEY },
    };
  }
  return {
    url: `${CLOUD_ENDPOINT}/ingest`,
    headers: { 'Content-Type': 'application/json', 'x-api-key': CLOUD_API_KEY },
  };
}

async function postWithRetry(payload, attempt = 1) {
  const { url, headers } = getEndpointConfig();
  try {
    const response = await axios.post(url, payload, { headers, timeout: 5000 });
    metrics.cloudCallSuccess();
    return response.data;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[Dispatcher] Retry ${attempt}/${MAX_RETRIES} in ${delay}ms — ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return postWithRetry(payload, attempt + 1);
    }
    metrics.cloudCallFailed();
    bufferPayload(payload);
    throw err;
  }
}

function bufferPayload(payload) {
  if (offlineBuffer.length < BUFFER_LIMIT) {
    offlineBuffer.push({ payload, bufferedAt: new Date().toISOString() });
    metrics.messageBuffered();
    console.warn(`[Dispatcher] Buffered offline. Buffer size: ${offlineBuffer.length}/${BUFFER_LIMIT}`);
  } else {
    console.error('[Dispatcher] Offline buffer full — oldest message dropped.');
    metrics.messageDropped();
  }
}

async function replayBuffer() {
  if (isReplaying || offlineBuffer.length === 0) return;
  isReplaying = true;
  console.log(`[Dispatcher] Replaying ${offlineBuffer.length} buffered messages…`);
  const toReplay = [...offlineBuffer];
  offlineBuffer.length = 0;
  for (const { payload } of toReplay) {
    try {
      await postWithRetry(payload, 1);
    } catch (err) {
      console.error('[Dispatcher] Replay failed — message re-buffered');
    }
  }
  isReplaying = false;
}

setInterval(replayBuffer, 30_000);

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Dispatch a single payload to the cloud (via Kafka, HTTP, or AWS).
 * @param {object} payload - Prioritised, aggregated sensor payload
 */
export async function dispatch(payload) {
  try {
    if (CLOUD_MODE === 'kafka') {
      await dispatchToKafka(payload);
    } else {
      await postWithRetry(payload);
    }

    const priorityIcon = { CRITICAL: '🔴', WARNING: '🟡', INFO: '🟢' }[payload.priority] || '⚪';
    const modeIcon = CLOUD_MODE === 'kafka' ? '📨' : '🌐';
    console.log(
      `[Dispatcher] ${priorityIcon}${modeIcon} ${payload.type.padEnd(20)} | ` +
      `mean=${payload.mean?.toFixed(2)} ${payload.unit} | ` +
      `n=${payload.count} | priority=${payload.priority} | ` +
      `anomaly=${payload.anomaly_score ?? 'n/a'}`
    );
  } catch (err) {
    console.error(`[Dispatcher] Failed to dispatch ${payload.type}: ${err.message}`);
  }
}

/** Returns current buffer and connection statistics for metrics endpoint. */
export function getBufferStats() {
  return {
    buffered:    offlineBuffer.length,
    bufferLimit: BUFFER_LIMIT,
    isReplaying,
    cloudMode:   CLOUD_MODE,
    kafkaTopic:  CLOUD_MODE === 'kafka' ? KAFKA_TOPIC : null,
  };
}
