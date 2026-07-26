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
        <div>
          <div className="header-title" style={{ fontSize: '1.2rem', fontWeight: 800 }}>EdgeGuardian</div>
        </div>
      </div>

      <div className="header-right">
        <div className="header-status">
          <span className={`status-dot ${online ? '' : 'offline'}`} />
          <span>{online ? 'Fog Node Online' : 'Fog Node Offline'}</span>
        </div>
        </div>

        <div className="header-time">
          {time.toLocaleTimeString('en-IE', { hour12: false })}
        </div>
      </div>
    </header>
  );
}
