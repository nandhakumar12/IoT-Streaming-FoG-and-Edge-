import React from 'react';

/**
 * MetricsBar — Enhanced with Kafka, Redis, and Anomaly metrics
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives pre-fetched fogMetrics and backendMetrics as props
 * (polling is managed by App.jsx to avoid duplicate requests).
 */

function MetricItem({ value, label, sublabel, color, pulse }) {
  return (
    <div className="card metric-card" style={{ position: 'relative', overflow: 'hidden' }}>
      {pulse && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: color || 'var(--accent)',
          animation: 'shimmer 2s ease-in-out infinite',
        }} />
      )}
      <div className="metric-value" style={color ? { color } : {}}>
        {value ?? '—'}
      </div>
      <div className="metric-label">{label}</div>
      {sublabel && <div className="metric-sublabel">{sublabel}</div>}
    </div>
  );
}

export default function MetricsBar({ fogMetrics: fog, backendMetrics: backend }) {
  const cacheHitRate = backend?.cache_hit_rate;
  const kafkaConsumed = backend?.kafka_consumed;

  return (
    <div className="metrics-bar">
      <MetricItem
        value={fog ? `${fog.reduction_pct}%` : '—'}
        label="Message Reduction"
        sublabel="Fog vs raw stream"
        color={fog?.reduction_pct > 70 ? 'var(--success)' : 'var(--warning)'}
        pulse={fog?.reduction_pct > 70}
      />
      <MetricItem
        value={fog ? fog.received?.toLocaleString() : '—'}
        label="MQTT Received"
        sublabel="Total from sensors"
      />
      <MetricItem
        value={fog ? fog.dispatched?.toLocaleString() : '—'}
        label="Kafka Produced"
        sublabel="fog.readings topic"
        color="var(--cyan)"
      />
      <MetricItem
        value={fog ? `${fog.avg_latency_ms}ms` : '—'}
        label="Fog Latency"
        sublabel="Avg pipeline time"
        color={fog?.avg_latency_ms < 10 ? 'var(--success)' : 'var(--warning)'}
      />
      <MetricItem
        value={fog ? fog.anomalies_detected?.toLocaleString() : '—'}
        label="AI Anomalies"
        sublabel={`Edge detection (${fog?.anomaly_rate ?? 0}%)`}
        color={fog?.anomalies_detected > 0 ? 'var(--danger)' : 'var(--text-muted)'}
      />
      <MetricItem
        value={cacheHitRate != null ? `${cacheHitRate}%` : '—'}
        label="Redis Hit Rate"
        sublabel="Cache vs SQLite"
        color={cacheHitRate > 70 ? 'var(--success)' : 'var(--warning)'}
      />
      <MetricItem
        value={kafkaConsumed != null ? kafkaConsumed.toLocaleString() : '—'}
        label="Kafka Consumed"
        sublabel="Backend consumer"
        color="var(--cyan)"
      />
      <MetricItem
        value={backend ? backend.total_stored?.toLocaleString() : '—'}
        label="DB Records"
        sublabel={backend?.backend_mode === 'local' ? 'SQLite (local)' : 'DynamoDB (AWS)'}
      />
    </div>
  );
}
