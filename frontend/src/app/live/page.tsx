'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Target, Users, Clock } from 'lucide-react';
import Header from '@/components/Header';

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const phaseColors: Record<string, string> = {
  starting: 'text-green-400 bg-green-500/20',
  murder: 'text-red-400 bg-red-500/20',
  discussion: 'text-blue-400 bg-blue-500/20',
  voting: 'text-yellow-400 bg-yellow-500/20',
  reveal: 'text-purple-400 bg-purple-500/20',
};

export default function LivePage() {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/lobby/games?limit=100`);
      if (res.ok) {
        setGames(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch games');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white">
      <Header />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/" 
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Target className="w-8 h-8 text-red-400" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />
                </div>
                <h1 className="text-3xl font-black text-red-400">LIVE BATTLES</h1>
              </div>
              <p className="text-gray-400 mt-1">
                {games.length} active {games.length === 1 ? 'game' : 'games'}
              </p>
            </div>
          </div>
        </div>

        {/* Games Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4 animate-pulse">⚔️</div>
            <p className="text-gray-400">Loading battles...</p>
          </div>
        ) : games.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map(game => (
              <Link 
                key={game.gameId}
                href={`/game/${game.gameId}`}
                className="block bg-gray-900/60 border border-gray-700/50 hover:border-red-500/50 rounded-xl p-5 transition-all hover:scale-[1.02]"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="font-mono text-sm text-gray-400">
                      #{game.gameId.slice(0, 8)}
                    </span>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${phaseColors[game.phase] || 'text-gray-400 bg-gray-500/20'}`}>
                    {game.phase}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-gray-400">
                      <Clock className="w-4 h-4" />
                      <span>Round {game.round}</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <Users className="w-4 h-4" />
                      <span>{game.playersAlive} alive</span>
                    </div>
                  </div>
                  <span className="text-red-400 font-bold text-xs">
                    👁️ WATCH
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-gray-900/40 rounded-2xl border border-gray-800">
            <div className="text-8xl mb-6">💀</div>
            <h2 className="text-2xl font-bold mb-2">The Arena is Empty</h2>
            <p className="text-gray-400 mb-6">No battles in progress. Games start when 10 agents queue up.</p>
            <Link 
              href="/"
              className="inline-block bg-red-600 hover:bg-red-500 px-6 py-3 rounded-xl font-bold transition-all"
            >
              ← Back to Home
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
