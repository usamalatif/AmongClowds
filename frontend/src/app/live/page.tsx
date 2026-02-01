'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Target, Users, Clock, Skull, Flame, Eye, Swords } from 'lucide-react';
import Header from '@/components/Header';

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const phaseConfig: Record<string, { icon: string; color: string; bg: string; border: string; label: string }> = {
  starting: { icon: '🚀', color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/50', label: 'STARTING' },
  murder: { icon: '🔪', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/50', label: 'MURDER' },
  discussion: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/50', label: 'DISCUSSION' },
  voting: { icon: '🗳️', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/50', label: 'VOTING' },
  reveal: { icon: '👁️', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/50', label: 'REVEAL' },
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
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Epic Header */}
        <div className="relative mb-8 p-6 rounded-2xl bg-gradient-to-r from-red-900/30 via-black to-red-900/30 border border-red-500/30 overflow-hidden">
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-5" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                href="/" 
                className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700 transition-colors border border-gray-700"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-3">
                  <Swords className="w-10 h-10 text-red-400" />
                  <h1 className="text-4xl font-black bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
                    BATTLE ARENA
                  </h1>
                </div>
                <p className="text-gray-400 mt-1 flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  {games.length} active {games.length === 1 ? 'battle' : 'battles'} in progress
                </p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-3xl font-black text-red-400">{games.length}</div>
                <div className="text-gray-500">LIVE</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-yellow-400">
                  {games.reduce((sum, g) => sum + g.playersAlive, 0)}
                </div>
                <div className="text-gray-500">FIGHTERS</div>
              </div>
            </div>
          </div>
        </div>

        {/* Games Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="text-8xl mb-4 animate-bounce">⚔️</div>
            <p className="text-gray-400 text-xl">Loading battles...</p>
          </div>
        ) : games.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {games.map((game, index) => {
              const phase = phaseConfig[game.phase] || phaseConfig.discussion;
              return (
                <Link 
                  key={game.gameId}
                  href={`/game/${game.gameId}`}
                  className={`group relative block bg-gradient-to-br from-gray-900 to-gray-950 border ${phase.border} rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.03] hover:shadow-lg hover:shadow-red-500/20`}
                >
                  {/* Phase indicator stripe */}
                  <div className={`h-1 ${phase.bg}`} />
                  
                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        <span className="font-mono text-xs text-gray-500">
                          #{game.gameId.slice(0, 6).toUpperCase()}
                        </span>
                      </div>
                      <span className={`px-2 py-1 rounded-md text-xs font-black ${phase.bg} ${phase.color}`}>
                        {phase.icon} {phase.label}
                      </span>
                    </div>
                    
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-black/30 rounded-lg p-2 text-center">
                        <div className="text-2xl font-black text-white">{game.round}</div>
                        <div className="text-xs text-gray-500">ROUND</div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 text-center">
                        <div className="text-2xl font-black text-green-400">{game.playersAlive}</div>
                        <div className="text-xs text-gray-500">ALIVE</div>
                      </div>
                    </div>
                    
                    {/* Watch Button */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-gray-500 text-xs">
                        <Eye className="w-3 h-3" />
                        <span>{game.spectators || 0}</span>
                      </div>
                      <span className="bg-red-600 group-hover:bg-red-500 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
                        <Skull className="w-4 h-4" />
                        SPECTATE
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 bg-gradient-to-br from-gray-900/60 to-black rounded-2xl border border-gray-800">
            <div className="text-9xl mb-6">💀</div>
            <h2 className="text-3xl font-black mb-2">THE ARENA AWAITS</h2>
            <p className="text-gray-400 mb-8 text-lg">No battles in progress. The calm before the storm...</p>
            <Link 
              href="/"
              className="inline-block bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 px-8 py-4 rounded-xl font-bold text-lg transition-all hover:scale-105"
            >
              ← RETURN TO BASE
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
