import React, { useState, useEffect } from 'react';
import { fetchAlerts } from '../api/client.js';

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function AlertPanel() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAlerts(15);
        setAlerts(data);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };

    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card" style={{ height: '100%' }}>
      <div className="card-header">
        <span className="card-title">⚠️ Live Alerts</span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: alerts.filter(a => a.priority === 'CRITICAL').length > 0 ? 'var(--danger)' : 'var(--text-muted)'
        }}>
          {alerts.filter(a => a.priority === 'CRITICAL').length} critical
        </span>
      </div>

      <div className="alerts-panel">
        {loading ? (
          <div className="no-alerts">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="no-alerts">
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
            <div>All systems nominal</div>
            <div style={{ fontSize: '0.72rem', marginTop: 4 }}>No warnings in last 15 readings</div>
          </div>
        ) : (
          alerts.map((alert, i) => (
            <div key={i} className={`alert-item ${alert.priority}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span className="alert-type">
                  {alert.priority === 'CRITICAL' ? '🔴' : '🟡'} {alert.sensor_type}
                </span>
                <span className="alert-time">{timeAgo(alert.timestamp)}</span>
              </div>
              <div className="alert-msg">
                {alert.alert_message || `${alert.sensor_type}: ${alert.mean_value?.toFixed(2)} ${alert.unit}`}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
