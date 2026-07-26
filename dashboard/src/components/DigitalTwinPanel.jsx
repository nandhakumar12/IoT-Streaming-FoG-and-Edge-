import React, { useState, useEffect } from 'react';
import { fetchFogMetrics, fetchBackendMetrics, fetchLatest } from '../api/client.js';

/**
 * Digital Twin Panel
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows the "shadow state" of each virtual sensor device in real-time.
 * A Digital Twin is a live digital representation of a physical device,
 * updated continuously from sensor telemetry [Grieves, 2016; ISO 23247].
 *
 * Displays:
 *  - Current value with trend indicator (↑ ↓ →)
 *  - Anomaly score (0.0 = normal, 1.0 = anomaly) as a coloured gauge
 *  - Priority badge (CRITICAL / WARNING / INFO)
 *  - Last update timestamp
 *  - Health status: ONLINE / STALE / OFFLINE
 */

const SENSOR_CONFIG = {
  temperature:       { label: 'Temperature',  icon: '🌡️',  unit: '°C',   color: '#ef4444' },
  vibration:         { label: 'Vibration',    icon: '📳',  unit: 'g',    color: '#f59e0b' },
  humidity:          { label: 'Humidity',     icon: '💧',  unit: '%RH',  color: '#3b82f6' },
  pressure:          { label: 'Pressure',     icon: '🔵',  unit: 'hPa',  color: '#8b5cf6' },
  power_consumption: { label: 'Power',        icon: '⚡',  unit: 'W',    color: '#22d3ee' },
};

function AnomalyGauge({ score }) {
  // score: 0.0 (green) → 1.0 (red), null = unknown
  const pct     = score != null ? Math.round(score * 100) : null;
  const color   = score == null ? '#6b7280'
    : score < 0.3 ? '#22c55e'
    : score < 0.6 ? '#f59e0b'
    : '#ef4444';
  const label   = score == null ? '—'
    : score < 0.3 ? 'Normal'
    : score < 0.6 ? 'Elevated'
    : 'Anomaly';

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>AI Anomaly Score</span>
        <span style={{ fontSize: '0.65rem', color, fontWeight: 600 }}>
          {pct != null ? `${pct}% — ${label}` : 'N/A'}
        </span>
      </div>
      <div style={{
        width: '100%', height: 5, borderRadius: 3,
        background: 'var(--surface-2)',
        overflow: 'hidden',
      }}>
        <div style={{
          width:      `${pct ?? 0}%`,
          height:     '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.5s ease, background 0.5s ease',
        }} />
      </div>
    </div>
  );
}

function TwinCard({ sensorType, data, anomalyData }) {
  const cfg        = SENSOR_CONFIG[sensorType] || { label: sensorType, icon: '📡', unit: '', color: '#6b7280' };
  const value      = data?.mean_value ?? data?.raw_value;
  const priority   = data?.priority || 'INFO';
  const anomalyScore = data?.anomaly_score ?? anomalyData?.score;

  // Health status based on last update time
  const lastUpdated = data?.ingested_at ? new Date(data.ingested_at) : null;
  const ageSecs     = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 1000 : null;
  const health      = ageSecs == null ? 'OFFLINE'
    : ageSecs < 15 ? 'ONLINE'
    : ageSecs < 60 ? 'STALE'
    : 'OFFLINE';

  const healthColor = health === 'ONLINE' ? '#22c55e' : health === 'STALE' ? '#f59e0b' : '#6b7280';

  const priorityBg = {
    CRITICAL: 'rgba(239, 68, 68, 0.12)',
    WARNING:  'rgba(245, 158, 11, 0.10)',
    INFO:     'transparent',
  }[priority] || 'transparent';

  return (
    <div style={{
      background:   `linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)`,
      border:       `1px solid ${priority === 'CRITICAL' ? '#ef4444' : priority === 'WARNING' ? '#f59e0b' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding:      'var(--space-md)',
      backgroundColor: priorityBg,
      transition:   'all 0.3s ease',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Sensor colour accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: cfg.color, borderRadius: '12px 12px 0 0',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.2rem' }}>{cfg.icon}</span>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {cfg.label}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Digital Twin
            </div>
          </div>
        </div>
        <div style={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
          color: healthColor, textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: healthColor,
            boxShadow: health === 'ONLINE' ? `0 0 6px ${healthColor}` : 'none',
            display: 'inline-block',
          }} />
          {health}
        </div>
      </div>

      {/* Value */}
      <div style={{ marginTop: 10, textAlign: 'center' }}>
        <div style={{
          fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em',
          color: priority === 'CRITICAL' ? '#ef4444' : priority === 'WARNING' ? '#f59e0b' : 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
        }}>
          {value != null ? value.toFixed(2) : '—'}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{cfg.unit}</div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 8,
      }}>
        {data?.min_value != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Min</div>
            <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {data.min_value.toFixed(2)}
            </div>
          </div>
        )}
        {data?.max_value != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Max</div>
            <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {data.max_value.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Anomaly gauge */}
      <AnomalyGauge score={anomalyScore} />

      {/* Priority badge + timestamp */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 600, padding: '2px 6px',
          borderRadius: 4, letterSpacing: '0.03em',
          background: priority === 'CRITICAL' ? 'rgba(239,68,68,0.2)'
            : priority === 'WARNING' ? 'rgba(245,158,11,0.2)'
            : 'var(--surface-3)',
          color: priority === 'CRITICAL' ? '#ef4444'
            : priority === 'WARNING' ? '#f59e0b'
            : 'var(--text-muted)',
        }}>
          {priority === 'CRITICAL' ? '🔴' : priority === 'WARNING' ? '🟡' : '🟢'} {priority}
        </span>
        <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {lastUpdated
            ? lastUpdated.toLocaleTimeString()
            : 'No data'}
        </span>
      </div>
    </div>
  );
}

export default function DigitalTwinPanel({ fogMetrics }) {
  const [latest, setLatest] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const { fetchLatest } = await import('../api/client.js');
        const data = await fetchLatest();
        setLatest(data);
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  // Extract per-sensor anomaly data from fog metrics if available
  const anomalyPerSensor = fogMetrics?.anomaly?.per_sensor || {};

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="card-title">🤖 Digital Twin Monitor</span>
          <span style={{
            fontSize: '0.62rem', color: 'var(--text-muted)',
            padding: '2px 8px', border: '1px solid var(--border)',
            borderRadius: 12, fontFamily: 'var(--font-mono)',
          }}>
            Live shadow state · Edge AI scoring · 2s refresh
          </span>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Each card represents a virtual IoT device's real-time shadow state with Isolation Forest anomaly scoring at the fog node.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 'var(--space-md)',
      }}>
        {Object.keys(SENSOR_CONFIG).map(sensorType => (
          <TwinCard
            key={sensorType}
            sensorType={sensorType}
            data={latest[sensorType]}
            anomalyData={anomalyPerSensor[sensorType]}
          />
        ))}
      </div>
    </div>
  );
}
