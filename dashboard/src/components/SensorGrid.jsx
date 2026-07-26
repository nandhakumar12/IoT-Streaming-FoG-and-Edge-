import React, { useState, useEffect } from 'react';
import { fetchLatest, SENSOR_CONFIG } from '../api/client.js';

function SensorCard({ sensorType, data, active, onClick }) {
  const config = SENSOR_CONFIG[sensorType] || { label: sensorType, icon: '📡', unit: '' };
  const value = data?.mean_value ?? data?.raw_value;
  const priority = data?.priority || 'INFO';
  const hasData = value !== undefined && value !== null;

  return (
    <div
      id={`sensor-card-${sensorType}`}
      className={`card sensor-card ${priority} ${active ? 'active' : ''}`}
      onClick={() => onClick(sensorType)}
      style={active ? { borderColor: config.color, boxShadow: `0 0 20px ${config.color}30` } : {}}
      role="button"
      tabIndex={0}
      aria-label={`${config.label} sensor card`}
    >
      <span className="sensor-icon">{config.icon}</span>
      <div className="sensor-label">{config.label}</div>

      <div className="sensor-value" style={hasData ? {} : { fontSize: '1.2rem', opacity: 0.4 }}>
        {hasData ? value.toFixed(2) : '—'}
      </div>
      <div className="sensor-unit">{config.unit}</div>

      <div className="sensor-meta">
        <span className={`priority-badge ${priority}`}>
          {priority === 'CRITICAL' ? '🔴' : priority === 'WARNING' ? '🟡' : '🟢'} {priority}
        </span>
        {data?.count && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            n={data.count}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SensorGrid({ activeSensor, onSensorSelect }) {
  const [latest, setLatest] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchLatest();
        setLatest(data);
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="sensor-grid">
      {Object.keys(SENSOR_CONFIG).map(sensorType => (
        <SensorCard
          key={sensorType}
          sensorType={sensorType}
          data={latest[sensorType]}
          active={activeSensor === sensorType}
          onClick={onSensorSelect}
        />
      ))}
    </div>
  );
}
