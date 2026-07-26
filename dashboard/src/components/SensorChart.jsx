import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';
import { fetchReadings, SENSOR_CONFIG } from '../api/client.js';

// ── Custom Tooltip ──────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-accent)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      boxShadow: 'var(--shadow-card)',
    }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: 6 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(3) : p.value} {unit}
        </p>
      ))}
    </div>
  );
};

// ── Main Component ──────────────────────────────────────────────────────────
export default function SensorChart({ sensorType }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const config = SENSOR_CONFIG[sensorType] || {};

  const load = useCallback(async () => {
    try {
      const readings = await fetchReadings(sensorType, 60);
      setData(readings);
    } catch (err) {
      // Silently fail — dashboard keeps showing last data
    } finally {
      setLoading(false);
    }
  }, [sensorType]);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="chart-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading chart…</span>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="chart-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: '2rem' }}></span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Waiting for {config.label} data…</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ensure sensors and fog node are running</span>
      </div>
    );
  }

  // Latest value for display
  const latest = data[data.length - 1];
  const hasMinMax = data.some(d => d.min !== undefined && d.min !== null);

  return (
    <div>
      {/* Current reading summary */}
      <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Mean</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: config.chartColor }}>
            {latest?.value?.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{config.unit}</span>
          </div>
        </div>
        {hasMinMax && (
          <>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Min</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--text-secondary)' }}>
                {latest?.min?.toFixed(2)} {config.unit}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Max</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--danger)' }}>
                {latest?.max?.toFixed(2)} {config.unit}
              </div>
            </div>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <span className={`priority-badge ${latest?.priority || 'INFO'}`}>
            {latest?.priority === 'CRITICAL' ? '' : latest?.priority === 'WARNING' ? '' : ''} {latest?.priority || 'INFO'}
          </span>
        </div>
      </div>

      {/* Recharts line chart */}
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
            <XAxis
              dataKey="time"
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(99,102,241,0.15)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v?.toFixed(1)}
            />
            <Tooltip content={<CustomTooltip unit={config.unit} />} />
            {hasMinMax && (
              <>
                <Line type="monotone" dataKey="min"   stroke="var(--text-secondary)" strokeWidth={1} dot={false} name="Min" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="max"   stroke="var(--danger)" strokeWidth={1} dot={false} name="Max" strokeDasharray="4 4" />
              </>
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={config.chartColor}
              strokeWidth={2.5}
              dot={false}
              name="Mean"
              activeDot={{ r: 5, fill: config.chartColor, stroke: 'var(--bg-card)', strokeWidth: 2 }}
            />
            {hasMinMax && <Legend wrapperStyle={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
