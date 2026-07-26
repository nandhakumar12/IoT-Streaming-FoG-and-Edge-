import React, { useState, useEffect } from 'react';

export default function Header() {
  const [time, setTime] = useState(new Date());
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const tick = setInterval(() => setTime(new Date()), 1000);

    // Check fog node health
    const check = setInterval(async () => {
      try {
        const fogUrl = import.meta.env.VITE_FOG_API_BASE_URL || 'http://localhost:3001';
        await fetch(`${fogUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
        setOnline(true);
      } catch {
        setOnline(false);
      }
    }, 10_000);

    return () => { clearInterval(tick); clearInterval(check); };
  }, []);

  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-icon"></div>
        <div>
          <div className="header-title">EdgeGuardian</div>
          <div className="header-subtitle">AIoT Fog Computing Monitor</div>
        </div>
      </div>

      <div className="header-right">
        <div className="header-status">
          <span className={`status-dot ${online ? '' : 'offline'}`} />
          <span>{online ? 'Fog Node Online' : 'Fog Node Offline'}</span>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border-subtle)' }} />

        <div className="header-status">
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            NCI H9FECC · Smart Industrial Monitoring
          </span>
        </div>

        <div className="header-time">
          {time.toLocaleTimeString('en-IE', { hour12: false })}
        </div>
      </div>
    </header>
  );
}
