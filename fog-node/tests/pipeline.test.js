/**
 * EdgeGuardian – Fog Node Unit Tests
 * Uses Node.js built-in test runner (node --test), no extra dependencies needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Validator logic ───────────────────────────────────────────────────────────
describe('Schema Validator', () => {
  const REQUIRED_FIELDS = ['device_id', 'timestamp', 'sensor_type', 'value'];
  const VALID_SENSOR_TYPES = ['temperature', 'vibration', 'humidity', 'pressure', 'power_consumption'];

  function validate(payload) {
    if (!payload || typeof payload !== 'object') return { valid: false, error: 'Not an object' };
    for (const field of REQUIRED_FIELDS) {
      if (!(field in payload)) return { valid: false, error: `Missing field: ${field}` };
    }
    if (!VALID_SENSOR_TYPES.includes(payload.sensor_type)) {
      return { valid: false, error: `Unknown sensor_type: ${payload.sensor_type}` };
    }
    if (typeof payload.value !== 'number') {
      return { valid: false, error: 'value must be a number' };
    }
    return { valid: true };
  }

  it('accepts a fully valid payload', () => {
    const result = validate({
      device_id: 'TEMP-01',
      timestamp: '2025-01-01T00:00:00.000Z',
      sensor_type: 'temperature',
      value: 72.3,
    });
    assert.equal(result.valid, true);
  });

  it('rejects a payload missing device_id', () => {
    const result = validate({
      timestamp: '2025-01-01T00:00:00.000Z',
      sensor_type: 'temperature',
      value: 72.3,
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /device_id/);
  });

  it('rejects an unknown sensor_type', () => {
    const result = validate({
      device_id: 'TEMP-01',
      timestamp: '2025-01-01T00:00:00.000Z',
      sensor_type: 'unknown_sensor',
      value: 10,
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /sensor_type/);
  });

  it('rejects a non-numeric value', () => {
    const result = validate({
      device_id: 'TEMP-01',
      timestamp: '2025-01-01T00:00:00.000Z',
      sensor_type: 'temperature',
      value: 'hot',
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /number/);
  });
});

// ── IQR Noise Filter ──────────────────────────────────────────────────────────
describe('IQR Noise Filter', () => {
  function iqrFilter(buffer, value) {
    if (buffer.length < 4) return true; // not enough data → pass through
    const sorted = [...buffer].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    return value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr;
  }

  it('passes a normal reading within IQR bounds', () => {
    const buffer = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79];
    assert.equal(iqrFilter(buffer, 75), true);
  });

  it('rejects a spike far outside IQR bounds', () => {
    const buffer = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79];
    assert.equal(iqrFilter(buffer, 500), false);
  });

  it('passes through when buffer has fewer than 4 readings', () => {
    assert.equal(iqrFilter([70, 71], 9999), true);
  });
});

// ── Priority Classification ───────────────────────────────────────────────────
describe('Priority Classifier', () => {
  function classify(score) {
    if (score > 0.7) return 'CRITICAL';
    if (score > 0.4) return 'WARNING';
    return 'INFO';
  }

  it('classifies score 0.85 as CRITICAL', () => {
    assert.equal(classify(0.85), 'CRITICAL');
  });

  it('classifies score 0.55 as WARNING', () => {
    assert.equal(classify(0.55), 'WARNING');
  });

  it('classifies score 0.2 as INFO', () => {
    assert.equal(classify(0.2), 'INFO');
  });

  it('classifies boundary score 0.7 as WARNING (not CRITICAL)', () => {
    assert.equal(classify(0.7), 'WARNING');
  });
});

// ── Adaptive Window ───────────────────────────────────────────────────────────
describe('Adaptive Window Selector', () => {
  function selectWindow(anomalyRate) {
    if (anomalyRate > 0.20) return 5000;
    if (anomalyRate > 0.05) return 10000;
    return 30000;
  }

  it('returns 5s window when anomaly rate > 20%', () => {
    assert.equal(selectWindow(0.25), 5000);
  });

  it('returns 10s window when anomaly rate between 5% and 20%', () => {
    assert.equal(selectWindow(0.10), 10000);
  });

  it('returns 30s window when anomaly rate <= 5%', () => {
    assert.equal(selectWindow(0.02), 30000);
  });
});
