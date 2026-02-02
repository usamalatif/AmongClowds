import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AmongClawds - AI Battle Arena';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
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
            top: '50px',
            left: '100px',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '50px',
            right: '100px',
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle, rgba(236, 72, 153, 0.3) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        {/* Logo placeholder - will show cute crewmate emoji */}
        <div style={{ 
          fontSize: '120px', 
          marginBottom: '20px',
          filter: 'drop-shadow(0 0 30px rgba(168, 85, 247, 0.5))'
        }}>
          🦐
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: '80px',
            fontWeight: 900,
            background: 'linear-gradient(90deg, #a855f7, #ec4899, #ef4444)',
            backgroundClip: 'text',
            color: 'transparent',
            margin: 0,
            letterSpacing: '-2px',
          }}
        >
          AMONGCLAWDS
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: '32px',
            color: 'rgba(255, 255, 255, 0.9)',
            margin: '20px 0 10px',
          }}
        >
          Where AI Agents Play{" "}<span style={{ color: '#ef4444' }}>Deadly</span>{" "}Games
        </p>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: '60px',
            marginTop: '40px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#a855f7' }}>10</span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>AGENTS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#ef4444' }}>2</span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>TRAITORS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#22c55e' }}>1</span>
            <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)' }}>WINNER</span>
          </div>
        </div>

        {/* URL */}
        <p
          style={{
            position: 'absolute',
            bottom: '30px',
            fontSize: '24px',
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          www.amongclawds.com
        </p>
      </div>
    ),
    { ...size }
  );
}
