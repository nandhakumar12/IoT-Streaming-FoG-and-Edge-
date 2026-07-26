import React, { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import SensorGrid from './components/SensorGrid.jsx';
import SensorChart from './components/SensorChart.jsx';
import AlertPanel from './components/AlertPanel.jsx';
import MetricsBar from './components/MetricsBar.jsx';
import DigitalTwinPanel from './components/DigitalTwinPanel.jsx';
import ArchitectureDiagram from './components/ArchitectureDiagram.jsx';
import { SENSOR_CONFIG, fetchFogMetrics, fetchBackendMetrics } from './api/client.js';

const TABS = [
  { id: 'dashboard',    label: '📊 Dashboard'   },
  { id: 'twins',        label: '🤖 Digital Twins'},
  { id: 'architecture', label: '🏗️ Architecture' },
];

export default function App() {
  const [activeSensor, setActiveSensor] = useState('temperature');
  const [activeTab,    setActiveTab]    = useState('dashboard');
  const [fogMetrics,   setFogMetrics]   = useState(null);
  const [backendMetrics, setBackendMetrics] = useState(null);

  // Shared metrics polling (used by multiple panels)
  useEffect(() => {
    const load = async () => {
      try { setFogMetrics(await fetchFogMetrics()); }     catch { /* offline */ }
      try { setBackendMetrics(await fetchBackendMetrics()); } catch { /* offline */ }
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-layout">
      <Header />

      <main className="main-content">

        {/* ── Tab Nav ── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 'var(--space-lg)',
          borderBottom: '1px solid var(--border)', paddingBottom: 0,
        }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding:      '8px 18px',
                border:       'none',
                background:   'transparent',
                cursor:       'pointer',
                fontSize:     '0.8rem',
                fontWeight:   activeTab === tab.id ? 700 : 400,
                color:        activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                transition:   'all 0.2s',
                marginBottom: '-1px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Dashboard ── */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Sensor Cards */}
            <SensorGrid activeSensor={activeSensor} onSensorSelect={setActiveSensor} />

            {/* Chart + Alerts */}
            <div className="dashboard-grid">
              <div className="chart-section">
                <div className="card" style={{ flex: 1 }}>
                  <div className="card-header">
                    <span className="card-title">
                      {SENSOR_CONFIG[activeSensor]?.icon} {SENSOR_CONFIG[activeSensor]?.label} — Time Series
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      10s aggregation windows · mean/min/max
                    </span>
                  </div>

                  <div className="chart-tabs" style={{ marginBottom: 'var(--space-md)' }}>
                    {Object.entries(SENSOR_CONFIG).map(([type, cfg]) => (
                      <button
                        key={type}
                        id={`chart-tab-${type}`}
                        className={`chart-tab ${activeSensor === type ? 'active' : ''}`}
                        onClick={() => setActiveSensor(type)}
                        aria-label={`View ${cfg.label} chart`}
                      >
                        {cfg.icon} {cfg.label}
                      </button>
                    ))}
                  </div>

                  <SensorChart sensorType={activeSensor} />
                </div>
              </div>

              <AlertPanel />
            </div>

            {/* Fog Metrics Bar */}
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <div style={{ marginBottom: 'var(--space-sm)' }}>
                <span className="card-title">⚙️ Fog Node Metrics</span>
                <span style={{ marginLeft: 12, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Live from fog node metrics API (port 3001) · Kafka mode · Redis cache
                </span>
              </div>
              <MetricsBar fogMetrics={fogMetrics} backendMetrics={backendMetrics} />
            </div>
          </div>
        )}

        {/* ── Tab: Digital Twins ── */}
        {activeTab === 'twins' && (
          <div>
            <DigitalTwinPanel fogMetrics={fogMetrics} />
          </div>
        )}

        {/* ── Tab: Architecture ── */}
        {activeTab === 'architecture' && (
          <div>
            <ArchitectureDiagram fogMetrics={fogMetrics} backendMetrics={backendMetrics} />

            {/* Pipeline stages explanation */}
            <div style={{ marginTop: 'var(--space-xl)' }}>
              <span className="card-title">📋 5-Stage Fog Pipeline</span>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 'var(--space-md)', marginTop: 'var(--space-md)',
              }}>
                {[
                  { n: 1, title: 'Schema Validation', desc: 'AJV JSON Schema — rejects malformed payloads' },
                  { n: 2, title: 'Noise Filtering',   desc: 'IQR method on 20-reading sliding window' },
                  { n: 3, title: 'Time Aggregation',  desc: '10s tumbling window → mean/min/max/std' },
                  { n: 4, title: 'Adaptive Sampling', desc: 'Anomaly rate adjusts window duration' },
                  { n: 5, title: 'Prioritisation',    desc: 'CRITICAL / WARNING / INFO tiers → dispatch' },
                ].map(stage => (
                  <div key={stage.n} className="card" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--accent)', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
                      }}>{stage.n}</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {stage.title}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>
                      {stage.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
