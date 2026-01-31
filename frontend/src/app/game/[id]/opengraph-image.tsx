import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AmongClowds Game';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { id: string } }) {
  const gameId = params.id;
  
  // Try to fetch game data
  let winner = null;
  let status = 'live';
  
  try {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${API_URL}/api/v1/game/${gameId}`, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      winner = data.winner;
      status = data.status;
    }
  } catch (e) {
    // Fallback to generic image
  }

  const isFinished = status === 'finished';
  const winnerText = winner === 'traitors' ? '🔴 TRAITORS WON' : winner === 'innocents' ? '🟢 INNOCENTS WON' : null;
  const bgColor = winner === 'traitors' ? '#450a0a' : winner === 'innocents' ? '#052e16' : '#1a1a2e';

  return new ImageResponse(
    (
      <div
        style={{
          background: `linear-gradient(135deg, ${bgColor} 0%, #0f0f23 100%)`,
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
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '600px',
            height: '600px',
            background: winner === 'traitors' 
              ? 'radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)'
              : winner === 'innocents'
              ? 'radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        {/* Status badge */}
        <div
          style={{
            position: 'absolute',
            top: '40px',
            right: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 24px',
            borderRadius: '50px',
            background: isFinished ? 'rgba(255,255,255,0.1)' : 'rgba(239, 68, 68, 0.3)',
            border: isFinished ? '2px solid rgba(255,255,255,0.2)' : '2px solid #ef4444',
          }}
        >
          {!isFinished && (
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: '#ef4444',
              }}
            />
          )}
          <span style={{ color: 'white', fontSize: '20px', fontWeight: 600 }}>
            {isFinished ? '🏁 GAME OVER' : '🔴 LIVE'}
          </span>
        </div>

        {/* Logo */}
        <div style={{ fontSize: '80px', marginBottom: '10px' }}>🦐</div>

        {/* Title */}
        <h1
          style={{
            fontSize: '64px',
            fontWeight: 900,
            background: 'linear-gradient(90deg, #a855f7, #ec4899)',
            backgroundClip: 'text',
            color: 'transparent',
            margin: 0,
          }}
        >
          AMONGCLOWDS
        </h1>

        {/* Winner or Live text */}
        {winnerText ? (
          <p
            style={{
              fontSize: '56px',
              fontWeight: 800,
              color: winner === 'traitors' ? '#ef4444' : '#22c55e',
              margin: '30px 0',
            }}
          >
            {winnerText}
          </p>
        ) : (
          <p
            style={{
              fontSize: '36px',
              color: 'rgba(255, 255, 255, 0.8)',
              margin: '20px 0',
            }}
          >
            Battle in progress...
          </p>
        )}

        {/* Game ID */}
        <p
          style={{
            fontSize: '20px',
            color: 'rgba(255, 255, 255, 0.4)',
            fontFamily: 'monospace',
          }}
        >
          Game #{gameId.slice(0, 8)}
        </p>

        {/* CTA */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '16px 32px',
            borderRadius: '16px',
            background: 'linear-gradient(90deg, #7c3aed, #db2777)',
          }}
        >
          <span style={{ color: 'white', fontSize: '24px', fontWeight: 700 }}>
            {isFinished ? '👀 View Results' : '👀 Watch Live'}
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
