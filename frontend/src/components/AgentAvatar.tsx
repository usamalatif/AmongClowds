'use client';

// Deterministic avatar generator based on agent name
// Creates unique geometric patterns like GitHub identicons

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

const PALETTES = [
  ['#a855f7', '#7c3aed'], // purple
  ['#ec4899', '#db2777'], // pink
  ['#f43f5e', '#e11d48'], // rose
  ['#ef4444', '#dc2626'], // red
  ['#f97316', '#ea580c'], // orange
  ['#eab308', '#ca8a04'], // yellow
  ['#22c55e', '#16a34a'], // green
  ['#14b8a6', '#0d9488'], // teal
  ['#06b6d4', '#0891b2'], // cyan
  ['#3b82f6', '#2563eb'], // blue
  ['#6366f1', '#4f46e5'], // indigo
  ['#8b5cf6', '#7c3aed'], // violet
];

interface AgentAvatarProps {
  name: string;
  size?: number;
  className?: string;
  status?: 'alive' | 'murdered' | 'banished' | 'disconnected';
}

export default function AgentAvatar({ name, size = 32, className = '', status }: AgentAvatarProps) {
  const hash = hashCode(name);
  const rng = seededRandom(hash);

  // Pick colors from palette
  const palette = PALETTES[hash % PALETTES.length];
  const primary = palette[0];
  const secondary = palette[1];

  // Generate a 5x5 symmetric grid (only need 3 columns, mirror the rest)
  const grid: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 3; x++) {
      row.push(rng() > 0.45);
    }
    // Mirror: col 3 = col 1, col 4 = col 0
    grid.push([row[0], row[1], row[2], row[1], row[0]]);
  }

  const cellSize = size / 7; // 5 cells + 1 padding each side
  const padding = cellSize;
  const isDead = status === 'murdered' || status === 'banished' || status === 'disconnected';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`rounded-lg flex-shrink-0 ${isDead ? 'opacity-40 grayscale' : ''} ${className}`}
    >
      {/* Background */}
      <rect width={size} height={size} rx={size * 0.15} fill={`${secondary}30`} />
      
      {/* Grid cells */}
      {grid.map((row, y) =>
        row.map((filled, x) => {
          if (!filled) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={padding + x * cellSize}
              y={padding + y * cellSize}
              width={cellSize}
              height={cellSize}
              rx={cellSize * 0.15}
              fill={primary}
            />
          );
        })
      )}
      
      {/* Subtle inner glow */}
      <rect
        width={size}
        height={size}
        rx={size * 0.15}
        fill="none"
        stroke={primary}
        strokeWidth={1}
        opacity={0.3}
      />
    </svg>
  );
}
