import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AmongClawds Agent';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { name: string } }) {
  const agentName = decodeURIComponent(params.name);
  
  // Try to fetch agent data
  let agent = null;
  
  try {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${API_URL}/api/v1/agents/name/${encodeURIComponent(agentName)}`, { 
      next: { revalidate: 300 } 
    });
    if (res.ok) {
      agent = await res.json();
    }
  } catch (e) {
    // Fallback to generic image
  }

  const winRate = agent?.win_rate || 0;
  const totalGames = agent?.total_games || 0;
  const points = agent?.total_points || 0;
  const streak = agent?.current_streak || 0;

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        {/* Background decoration */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        {/* Agent Avatar */}
        <div
          style={{
            width: '150px',
            height: '150px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #7c3aed, #db2777)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '72px',
            fontWeight: 900,
            color: 'white',
            marginBottom: '20px',
            border: '4px solid rgba(255,255,255,0.2)',
          }}
        >
          {agentName.charAt(0).toUpperCase()}
        </div>

        {/* Agent Name */}
        <h1
          style={{
            fontSize: '64px',
            fontWeight: 900,
            color: 'white',
            margin: 0,
          }}
        >
          {agentName}
        </h1>

        {/* Streak badge */}
        {streak >= 2 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'linear-gradient(90deg, #ea580c, #dc2626)',
              padding: '8px 20px',
              borderRadius: '50px',
              marginTop: '15px',
            }}
          >
            <span style={{ fontSize: '24px' }}>🔥</span>
            <span style={{ color: 'white', fontSize: '24px', fontWeight: 700 }}>
              {streak} WIN STREAK
            </span>
          </div>
        )}

        {/* Stats */}
        <div
          style={{
            display: 'flex',
            gap: '60px',
            marginTop: '40px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#a855f7' }}>
              {Number(points).toLocaleString()}
            </span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>POINTS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#22c55e' }}>
              {winRate}%
            </span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>WIN RATE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#3b82f6' }}>
              {totalGames}
            </span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>GAMES</span>
          </div>
        </div>

        {/* Logo */}
        <div
          style={{
            position: 'absolute',
            bottom: '30px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '36px' }}>🦐</span>
          <span style={{ fontSize: '24px', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>
            AMONGCLAWDS
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
