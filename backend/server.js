/**
 * EdgeGuardian – Backend Server
 *
 * Consumes processed sensor events from Kafka and persists them to SQLite.
 * Redis is used to cache the latest reading per sensor so the dashboard can
 * serve fast responses without hitting the database on every poll.
 *
 * Each event is also forwarded asynchronously to AWS DynamoDB via the API
 * Gateway. This fan-out keeps the Kafka consumer loop non-blocking — a
 * DynamoDB timeout does not delay local writes or stall the dashboard.
 *
 * Endpoints:
 *   POST /ingest          – fallback HTTP ingest when Kafka is unavailable
 *   GET  /readings        – time-series data per sensor type
 *   GET  /readings/latest – most recent reading per sensor (Redis-cached)
 *   GET  /alerts          – CRITICAL and WARNING events
 *   GET  /metrics         – runtime stats (Kafka lag, cache hit rate, etc.)
 *   GET  /health          – liveness probe
 */

import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Kafka } from 'kafkajs';
import { createClient } from 'redis';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Database Setup ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'edgeguardian.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_type   TEXT    NOT NULL,
    timestamp     TEXT    NOT NULL,
    flushed_at    TEXT,
    mean_value    REAL,
    min_value     REAL,
    max_value     REAL,
    std_dev       REAL,
    count         INTEGER DEFAULT 1,
    unit          TEXT,
    priority      TEXT    DEFAULT 'INFO',
    alert_message TEXT,
    window_ms     INTEGER,
    is_bypass     INTEGER DEFAULT 0,
    raw_value     REAL,
    anomaly_score REAL,
    is_anomaly    INTEGER DEFAULT 0,
    ingested_at   TEXT    NOT NULL,
    source        TEXT    DEFAULT 'http'
  );

  CREATE INDEX IF NOT EXISTS idx_sensor_type ON readings(sensor_type);
  CREATE INDEX IF NOT EXISTS idx_timestamp   ON readings(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_priority    ON readings(priority);
  CREATE INDEX IF NOT EXISTS idx_anomaly     ON readings(is_anomaly);

  CREATE TABLE IF NOT EXISTS system_stats (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const insertReading = db.prepare(`
  INSERT INTO readings
    (sensor_type, timestamp, flushed_at, mean_value, min_value, max_value,
     std_dev, count, unit, priority, alert_message, window_ms, is_bypass,
     raw_value, anomaly_score, is_anomaly, ingested_at, source)
  VALUES
    (@sensor_type, @timestamp, @flushed_at, @mean_value, @min_value, @max_value,
     @std_dev, @count, @unit, @priority, @alert_message, @window_ms, @is_bypass,
     @raw_value, @anomaly_score, @is_anomaly, @ingested_at, @source)
`);

const queryReadings = db.prepare(`
  SELECT * FROM readings WHERE sensor_type = ? ORDER BY timestamp DESC LIMIT ?
`);

const queryLatestPerType = db.prepare(`
  SELECT r.* FROM readings r
  INNER JOIN (
    SELECT sensor_type, MAX(timestamp) as max_ts
    FROM readings GROUP BY sensor_type
  ) m ON r.sensor_type = m.sensor_type AND r.timestamp = m.max_ts
`);

const queryAlerts = db.prepare(`
  SELECT * FROM readings WHERE priority IN ('CRITICAL', 'WARNING')
  ORDER BY timestamp DESC LIMIT ?
`);

// Redis – used to cache the latest reading per sensor for fast dashboard reads
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_TTL  = 60;  // seconds

let redis = null;
let redisAvailable = false;
let cacheHits = 0;
let cacheMisses = 0;

async function connectRedis() {
  try {
    redis = createClient({ 
      socket: { 
        host: REDIS_HOST, 
        port: REDIS_PORT,
        connectTimeout: 2000 // 2 seconds timeout so it doesn't hang indefinitely without Redis
      } 
    });
    redis.on('error', (err) => {
      if (redisAvailable) console.warn('[Redis] Connection error:', err.message);
      redisAvailable = false;
    });
    redis.on('connect', () => {
      console.log(`[Redis] ✓ Connected to ${REDIS_HOST}:${REDIS_PORT}`);
      redisAvailable = true;
    });
    // Don't await forever, just catch error if it fails
    await redis.connect().catch(err => {
      console.warn('[Redis] Not available — caching disabled:', err.message);
      redisAvailable = false;
    });
  } catch (err) {
    console.warn('[Redis] Not available — caching disabled:', err.message);
    redisAvailable = false;
  }
}

async function cacheLatestReading(sensorType, row) {
  if (!redisAvailable || !redis) return;
  try {
    await redis.setEx(`latest:${sensorType}`, REDIS_TTL, JSON.stringify(row));
  } catch { /* ignore cache write failures */ }
}

async function getCachedLatest() {
  if (!redisAvailable || !redis) return null;
  try {
    const keys = await redis.keys('latest:*');
    if (!keys.length) return null;
    const values = await Promise.all(keys.map(k => redis.get(k)));
    const latest = {};
    for (let i = 0; i < keys.length; i++) {
      const sensorType = keys[i].replace('latest:', '');
      if (values[i]) latest[sensorType] = JSON.parse(values[i]);
    }
    cacheHits++;
    return Object.keys(latest).length > 0 ? latest : null;
  } catch {
    return null;
  }
}

// AWS mirror – each Kafka event is forwarded to DynamoDB via the API Gateway.
// Done asynchronously so a slow or failing AWS request never blocks the
// Kafka consumer or the local SQLite write.
const AWS_API_URL = process.env.AWS_API_GATEWAY_URL || '';
const AWS_API_KEY = process.env.AWS_API_KEY || '';

let awsMirrorEnabled = !!(AWS_API_URL && !AWS_API_URL.includes('REPLACE'));
let awsMirrored = 0;
let awsMirrorFailed = 0;

function mirrorToAWS(payload) {
  if (!awsMirrorEnabled) return;

  const body = JSON.stringify(payload);
  const url  = new URL(`${AWS_API_URL}/ingest`);

  const req = https.request({
    hostname: url.hostname,
    path:     url.pathname,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key':      AWS_API_KEY,
    },
    timeout: 4000,
  }, (res) => {
    if (res.statusCode === 202 || res.statusCode === 200) {
      awsMirrored++;
      if (awsMirrored % 10 === 0) {
        console.log(`[AWS Mirror] ✓ ${awsMirrored} messages mirrored to DynamoDB`);
      }
    } else {
      awsMirrorFailed++;
      console.warn(`[AWS Mirror] HTTP ${res.statusCode} for ${payload.type}`);
    }
    res.resume(); // drain response
  });

  req.on('error', (err) => {
    awsMirrorFailed++;
    // Silent — don't log every failure to avoid noise
  });

  req.on('timeout', () => {
    awsMirrorFailed++;
    req.destroy();
  });

  req.write(body);
  req.end();
}

// Kafka consumer – subscribes to fog.readings and drives the ingest pipeline
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const KAFKA_TOPIC  = process.env.KAFKA_TOPIC  || 'fog.readings';

let kafkaAvailable = false;
let kafkaMessagesConsumed = 0;

async function startKafkaConsumer() {
  try {
    const kafka = new Kafka({
      clientId: 'edgeguardian-backend',
      brokers: [KAFKA_BROKER],
      retry: { initialRetryTime: 500, retries: 5 },
    });

    const consumer = kafka.consumer({ groupId: 'edgeguardian-backend-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

    console.log(`[Kafka] ✓ Consumer connected — subscribed to ${KAFKA_TOPIC}`);
    kafkaAvailable = true;

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          ingestPayload(payload, 'kafka');
          kafkaMessagesConsumed++;

          if (kafkaMessagesConsumed % 50 === 0) {
            console.log(`[Kafka] Consumed ${kafkaMessagesConsumed} messages from ${KAFKA_TOPIC}`);
          }
        } catch (err) {
          console.error('[Kafka] Error processing message:', err.message);
        }
      },
    });
  } catch (err) {
    console.warn('[Kafka] Consumer connection failed — running without Kafka:', err.message);
    console.warn('[Kafka] The /health endpoint and HTTP ingest remain available.');
    kafkaAvailable = false;
  }
}

// ── Shared ingest logic ───────────────────────────────────────────────────────
function ingestPayload(payload, source = 'http') {
  const row = {
    sensor_type:   payload.type,
    timestamp:     payload.flushed_at || payload.timestamp || new Date().toISOString(),
    flushed_at:    payload.flushed_at || null,
    mean_value:    payload.mean ?? payload.value ?? null,
    min_value:     payload.min ?? null,
    max_value:     payload.max ?? null,
    std_dev:       payload.std_dev ?? null,
    count:         payload.count ?? 1,
    unit:          payload.unit || '',
    priority:      payload.priority || 'INFO',
    alert_message: payload.alert_message || null,
    window_ms:     payload.window_ms ?? null,
    is_bypass:     payload._bypass ? 1 : 0,
    raw_value:     payload.value ?? null,
    anomaly_score: payload.anomaly_score ?? null,
    is_anomaly:    payload.is_anomaly ? 1 : 0,
    ingested_at:   new Date().toISOString(),
    source,
  };

  insertReading.run(row);

  // Cache latest reading in Redis
  cacheLatestReading(payload.type, { ...row, id: totalIngested });

  // Fan-out: mirror to AWS DynamoDB asynchronously (non-blocking)
  // Kafka → SQLite (local speed layer) + AWS API GW → DynamoDB (cloud serving layer)
  mirrorToAWS(payload);

  totalIngested++;
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

let totalIngested = 0;
const startTime = Date.now();

// ── POST /ingest ──────────────────────────────────────────────────────────────
// Used when CLOUD_MODE=local (direct HTTP, no Kafka)
app.post('/ingest', (req, res) => {
  const payload = req.body;
  if (!payload || !payload.type) {
    return res.status(400).json({ error: 'Missing required field: type' });
  }
  try {
    ingestPayload(payload, 'http');
    res.status(201).json({ status: 'stored', id: totalIngested });
  } catch (err) {
    console.error('[Backend] Insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /readings ─────────────────────────────────────────────────────────────
app.get('/readings', (req, res) => {
  const sensorType = req.query.sensorType || 'temperature';
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const readings = queryReadings.all(sensorType, limit);
  res.json({ sensorType, readings, count: readings.length, fetchedAt: new Date().toISOString() });
});

// ── GET /readings/latest ──────────────────────────────────────────────────────
app.get('/readings/latest', async (req, res) => {
  // Try Redis cache first
  const cached = await getCachedLatest();
  if (cached) {
    return res.json({ latest: cached, fetchedAt: new Date().toISOString(), source: 'redis_cache' });
  }

  // Fallback to SQLite
  cacheMisses++;
  const rows = queryLatestPerType.all();
  const latest = {};
  for (const row of rows) latest[row.sensor_type] = row;
  res.json({ latest, fetchedAt: new Date().toISOString(), source: 'sqlite' });
});

// ── GET /alerts ───────────────────────────────────────────────────────────────
app.get('/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const alerts = queryAlerts.all(limit);
  res.json({ alerts, count: alerts.length });
});

// ── GET /metrics ──────────────────────────────────────────────────────────────
app.get('/metrics', (req, res) => {
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM readings').get();
  const byType = db.prepare(
    'SELECT sensor_type, COUNT(*) as c FROM readings GROUP BY sensor_type'
  ).all();
  const criticalCount = db.prepare(
    "SELECT COUNT(*) as c FROM readings WHERE priority='CRITICAL'"
  ).get();
  const anomalyCount = db.prepare(
    "SELECT COUNT(*) as c FROM readings WHERE is_anomaly=1"
  ).get();

  res.json({
    total_stored:      totalCount.c,
    total_ingested:    totalIngested,
    critical_events:   criticalCount.c,
    anomaly_events:    anomalyCount.c,
    by_sensor_type:    byType,
    uptime_ms:         Date.now() - startTime,
    backend_mode:      'local',
    kafka_available:   kafkaAvailable,
    kafka_consumed:    kafkaMessagesConsumed,
    kafka_topic:       KAFKA_TOPIC,
    redis_available:   redisAvailable,
    cache_hits:        cacheHits,
    cache_misses:      cacheMisses,
    cache_hit_rate:    (cacheHits + cacheMisses) > 0
      ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 1000) / 10
      : 0,
    // AWS fan-out mirror stats
    aws_mirror_enabled: awsMirrorEnabled,
    aws_mirrored:       awsMirrored,
    aws_mirror_failed:  awsMirrorFailed,
    aws_mirror_rate:    (awsMirrored + awsMirrorFailed) > 0
      ? Math.round((awsMirrored / (awsMirrored + awsMirrorFailed)) * 1000) / 10
      : 0,
    aws_endpoint:       awsMirrorEnabled ? AWS_API_URL : null,
    timestamp:          new Date().toISOString(),
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    mode:       'local',
    kafka:      kafkaAvailable,
    redis:      redisAvailable,
    aws_mirror: awsMirrorEnabled,
    timestamp:  new Date().toISOString(),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  await connectRedis();

  // Kafka consumer failure is non-fatal — the server still handles HTTP ingest
  startKafkaConsumer().catch(err => console.warn('[Backend] Kafka unavailable:', err.message));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Listening on http://localhost:${PORT}`);
    console.log(`[Backend] Kafka: ${KAFKA_BROKER} | Redis: ${REDIS_HOST}:${REDIS_PORT}`);
  });
}

main().catch(console.error);
