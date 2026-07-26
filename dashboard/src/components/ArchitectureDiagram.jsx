import React, { useState, useEffect, useRef } from 'react';

/**
 * System Architecture Diagram
 * ─────────────────────────────────────────────────────────────────────────────
 * An animated SVG showing live data flow through the EdgeStream pipeline:
 *
 *   Sensors → MQTT → Fog Node → [Anomaly AI] → Kafka → Backend → Dashboard
 *                                                     ↓
 *                                               Redis Cache
 *                                                     ↓
 *                                              AWS (optional)
 *
 * Animated data packets flow along the pipeline when the system is active.
 * Service status indicators show real-time health of each component.
 */

const NODE_W = 110;
const NODE_H = 52;
const GAP    = 50;

// Pipeline nodes with x,y position, icon, label, sublabel
const NODES = [
  { id: 'sensors',  x: 20,   y: 90, icon: '', label: 'Sensors',   sub: '5 virtual', color: 'var(--text-primary)' },
  { id: 'mqtt',     x: 160,  y: 90, icon: '', label: 'MQTT',      sub: 'Mosquitto', color: 'var(--text-secondary)' },
  { id: 'fog',      x: 300,  y: 90, icon: '', label: 'Fog Node',  sub: '5-stage',   color: 'var(--text-secondary)' },
  { id: 'anomaly',  x: 300,  y: 210, icon: '', label: 'AI Anomaly',sub: 'Isolation Forest', color: 'var(--warning)' },
  { id: 'kafka',    x: 440,  y: 90, icon: '', label: 'Kafka',     sub: 'fog.readings', color: 'var(--danger)' },
  { id: 'redis',    x: 440,  y: 210, icon: '', label: 'Redis',    sub: 'Cache',     color: 'var(--danger)' },
  { id: 'backend',  x: 580,  y: 90, icon: '', label: 'Backend',   sub: 'SQLite',    color: 'var(--success)' },
  { id: 'aws',      x: 580,  y: 210, icon: '', label: 'AWS',      sub: 'Optional',  color: 'var(--warning)' },
  { id: 'dashboard',x: 720,  y: 90, icon: '', label: 'Dashboard', sub: 'React',     color: 'var(--text-primary)' },
];

// Edges connecting nodes: [from, to, label]
const EDGES = [
  ['sensors',  'mqtt',     'QoS=1'],
  ['mqtt',     'fog',      'subscribe'],
  ['fog',      'anomaly',  'score()'],
  ['fog',      'kafka',    'produce'],
  ['kafka',    'backend',  'consume'],
  ['backend',  'redis',    'cache'],
  ['backend',  'aws',      'mirror'],
  ['backend',  'dashboard','poll 2s'],
];

function getNodeCenter(id) {
  const n = NODES.find(n => n.id === id);
  if (!n) return { x: 0, y: 0 };
  return { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 };
}

function EdgeArrow({ from, to, label, animOffset }) {
  const f = getNodeCenter(from);
  const t = getNodeCenter(to);

  // Shorten endpoints so arrows don't overlap nodes
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const pad = 26;
  const sx = f.x + (dx / len) * pad;
  const sy = f.y + (dy / len) * pad;
  const ex = t.x - (dx / len) * pad;
  const ey = t.y - (dy / len) * pad;

  const pathId = `path-${from}-${to}`;

  return (
    <g>
      <defs>
        <path id={pathId} d={`M ${sx} ${sy} L ${ex} ${ey}`} />
      </defs>
      {/* Edge line */}
      <line x1={sx} y1={sy} x2={ex} y2={ey}
        stroke="var(--border)" strokeWidth={1.5} strokeDasharray="4 3" />
      {/* Arrowhead */}
      <polygon
        points={`0,-4 8,0 0,4`}
        fill="var(--text-muted)"
        transform={`translate(${ex},${ey}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`}
      />
      {/* Animated packet dot */}
      <circle r={4} fill="var(--success)" opacity={0.9}>
        <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${animOffset}s`}>
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite"
          begin={`${animOffset}s`} />
      </circle>
      {/* Edge label */}
      {label && (
        <text
          x={(sx + ex) / 2}
          y={(sy + ey) / 2 - 6}
          textAnchor="middle"
          fontSize="8"
          fill="var(--text-muted)"
          fontFamily="monospace"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function PipelineNode({ id, x, y, icon, label, sub, color, isActive }) {
  return (
    <g>
      {/* Glow when active */}
      {isActive && (
        <rect x={x - 2} y={y - 2} width={NODE_W + 4} height={NODE_H + 4}
          rx={10} fill={color} opacity={0.08}>
          <animate attributeName="opacity" values="0.04;0.14;0.04" dur="2s" repeatCount="indefinite" />
        </rect>
      )}
      {/* Node box */}
      <rect x={x} y={y} width={NODE_W} height={NODE_H}
        rx={8} fill="var(--bg-card)"
        stroke={color} strokeWidth={isActive ? 1.5 : 1}
        style={{ filter: isActive ? `drop-shadow(0 0 6px ${color}66)` : 'none' }}
      />
      {/* Top colour strip */}
      <rect x={x} y={y} width={NODE_W} height={3} rx={8} fill={color} />
      <rect x={x} y={y + 1} width={NODE_W} height={3} fill={color} />

      {/* Icon */}
      <text x={x + 14} y={y + 30} fontSize="16" textAnchor="middle">{icon}</text>

      {/* Label */}
      <text x={x + 60} y={y + 24} textAnchor="middle" fontSize="10.5"
        fontWeight="600" fill="var(--text-primary)" fontFamily="Inter, sans-serif">
        {label}
      </text>
      {/* Sub-label */}
      <text x={x + 60} y={y + 38} textAnchor="middle" fontSize="8"
        fill="var(--text-muted)" fontFamily="monospace">
        {sub}
      </text>

      {/* Status dot */}
      <circle cx={x + NODE_W - 10} cy={y + 10} r={4} fill={isActive ? 'var(--success)' : 'var(--text-muted)'}>
        {isActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />}
      </circle>
    </g>
  );
}

export default function ArchitectureDiagram({ fogMetrics, backendMetrics }) {
  const isRunning = fogMetrics?.received > 0;

  const activeNodes = new Set(['sensors', 'mqtt', 'fog', 'dashboard']);
  if (isRunning) {
    activeNodes.add('kafka');
    activeNodes.add('backend');
    if (fogMetrics?.anomaly?.available) activeNodes.add('anomaly');
    if (backendMetrics?.redis_available)  activeNodes.add('redis');
    if (backendMetrics?.backend_mode === 'aws') activeNodes.add('aws');
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <span className="card-title">🏗️ System Architecture</span>
        <span style={{
          marginLeft: 12, fontSize: '0.62rem', color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          {isRunning ? '● Live pipeline active' : '○ Waiting for data…'}
        </span>
      </div>

      <div className="card" style={{ padding: 'var(--space-md)', overflow: 'auto' }}>
        <svg
          viewBox="0 0 860 290"
          style={{ width: '100%', minWidth: 700, height: 'auto' }}
          aria-label="EdgeStream system architecture diagram"
        >
          {/* Background grid */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="860" height="290" fill="url(#grid)" opacity={0.4} />

          {/* Title */}
          <text x="430" y="22" textAnchor="middle" fontSize="12" fontWeight="700"
            fill="var(--text-secondary)" fontFamily="Inter, sans-serif">
            EdgeStream — Scalable Fog Computing Pipeline
          </text>

          {/* Layer labels */}
          <text x="75"  y="60" textAnchor="middle" fontSize="8.5" fill="var(--text-muted)" fontFamily="monospace">EDGE LAYER</text>
          <text x="355" y="60" textAnchor="middle" fontSize="8.5" fill="var(--text-muted)" fontFamily="monospace">FOG LAYER</text>
          <text x="630" y="60" textAnchor="middle" fontSize="8.5" fill="var(--text-muted)" fontFamily="monospace">CLOUD LAYER</text>

          {/* Layer separators */}
          <line x1="140" y1="55" x2="140" y2="275" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 3" opacity={0.5} />
          <line x1="520" y1="55" x2="520" y2="275" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 3" opacity={0.5} />

          {/* Edges */}
          {EDGES.map(([from, to, label], i) => (
            <EdgeArrow key={`${from}-${to}`} from={from} to={to} label={label} animOffset={i * 0.4} />
          ))}

          {/* Nodes */}
          {NODES.map(n => (
            <PipelineNode
              key={n.id}
              {...n}
              isActive={activeNodes.has(n.id)}
            />
          ))}

          {/* Stats overlay */}
          {isRunning && (
            <g transform="translate(12, 260)">
              <rect width="500" height="22" rx="4" fill="var(--surface-1)" opacity={0.8} />
              <text x="8" y="15" fontSize="8.5" fill="var(--text-muted)" fontFamily="monospace">
                📥 {fogMetrics?.received?.toLocaleString() || 0} received  ·
                📤 {fogMetrics?.dispatched?.toLocaleString() || 0} dispatched  ·
                📉 {fogMetrics?.reduction_pct || 0}% reduction  ·
                 {fogMetrics?.anomalies_detected || 0} anomalies  ·
                ⏱ {fogMetrics?.avg_latency_ms || 0}ms avg latency
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
