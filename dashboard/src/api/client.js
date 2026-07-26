/**
 * EdgeGuardian Dashboard – API Client
 * Polls backend and fog metrics endpoints at configurable intervals.
 */

const BACKEND_URL       = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const FOG_METRICS_URL   = import.meta.env.VITE_FOG_API_BASE_URL || 'http://localhost:3001';
const POLL_INTERVAL     = parseInt(import.meta.env.VITE_POLL_INTERVAL_MS || '2000', 10);

// Sensor types and their display config
export const SENSOR_CONFIG = {
  temperature:      { label: 'Temperature',   icon: '',  unit: '°C',  color: 'var(--danger)', chartColor: 'var(--danger)' },
  vibration:        { label: 'Vibration',     icon: '',  unit: 'g',   color: 'var(--warning)', chartColor: '#fbbf24' },
  humidity:         { label: 'Humidity',      icon: '',  unit: '%RH', color: 'var(--text-secondary)', chartColor: 'var(--text-secondary)' },
  pressure:         { label: 'Pressure',      icon: '',  unit: 'hPa', color: 'var(--text-secondary)', chartColor: '#a78bfa' },
  power_consumption:{ label: 'Power',         icon: '',  unit: 'W',   color: 'var(--text-primary)', chartColor: '#67e8f9' },
};

/** Fetch wrapper with timeout */
async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/** Get latest reading per sensor type (for dashboard cards) */
export async function fetchLatest() {
  const data = await fetchWithTimeout(`${BACKEND_URL}/readings/latest`);
  return data.latest || {};
}

/** Get time-series readings for a specific sensor type */
export async function fetchReadings(sensorType, limit = 60) {
  const data = await fetchWithTimeout(
    `${BACKEND_URL}/readings?sensorType=${sensorType}&limit=${limit}`
  );
  // Reverse so oldest is first (for recharts left-to-right)
  return (data.readings || []).reverse().map(r => ({
    time:  new Date(r.timestamp || r.flushed_at).toLocaleTimeString(),
    value: r.mean_value ?? r.raw_value,
    min:   r.min_value,
    max:   r.max_value,
    priority: r.priority,
  }));
}

/** Get recent CRITICAL/WARNING alerts */
export async function fetchAlerts(limit = 15) {
  const data = await fetchWithTimeout(`${BACKEND_URL}/alerts?limit=${limit}`);
  return data.alerts || [];
}

/** Get fog node metrics */
export async function fetchFogMetrics() {
  const data = await fetchWithTimeout(`${FOG_METRICS_URL}/api/metrics`);
  return data;
}

/** Backend system metrics */
export async function fetchBackendMetrics() {
  const data = await fetchWithTimeout(`${BACKEND_URL}/metrics`);
  return data;
}

export { POLL_INTERVAL };

