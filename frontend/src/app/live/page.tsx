'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, Swords, Play, Users, Gamepad2 } from 'lucide-react';
import Header from '@/components/Header';

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  traitorsAlive: number;
  innocentsAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const phaseConfig: Record<string, { icon: string; color: string; bg: string }> = {
  starting: { icon: '🚀', color: 'text-green-400', bg: 'bg-green-500/20' },
  murder: { icon: '🔪', color: 'text-red-400', bg: 'bg-red-500/20' },
  discussion: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  voting: { icon: '🗳️', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  reveal: { icon: '👁️', color: 'text-purple-400', bg: 'bg-purple-500/20' },
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
    } finally {
      setLoading(false);
    }
  };

  const totalSpectators = games.reduce((sum, g) => sum + (g.spectators || 0), 0);
  const totalPlayers = games.reduce((sum, g) => sum + g.playersAlive, 0);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Header />
      
      {/* Subtle grid background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(239,68,68,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(239,68,68,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-red-600/5 rounded-full blur-[128px]" />
      </div>
      
      <main className="relative max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6 text-sm"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                  <Swords className="w-6 h-6 text-red-400" />
                </div>
                {games.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                )}
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Live Battles</h1>
                <p className="text-gray-500 text-sm">
                  {games.length > 0 
                    ? `${games.length} active ${games.length === 1 ? 'game' : 'games'} in progress`
                    : 'No active games right now'
                  }
                </p>
              </div>
            </div>
            
            {/* Stats */}
            {games.length > 0 && (
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                  <Users size={16} className="text-green-400" />
                  <span className="font-bold text-white">{totalPlayers}</span>
                  <span>alive</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <Eye size={16} />
                  <span className="font-bold text-white">{totalSpectators}</span>
                  <span>watching</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Games Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading battles...</p>
            </div>
          </div>
        ) : games.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map((game, index) => {
              const phase = phaseConfig[game.phase] || phaseConfig.discussion;
              return (
                <Link 
                  key={game.gameId}
                  href={`/game/${game.gameId}`}
                  className={`group block rounded-xl border transition-all hover:scale-[1.02] ${
                    index === 0 
                      ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border-yellow-500/30 hover:border-yellow-500/50' 
                      : 'bg-gray-900/50 border-gray-800 hover:border-red-500/50'
                  }`}
                >
                  {/* Phase stripe */}
                  <div className={`h-1 rounded-t-xl ${phase.bg}`} />
                  
                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        {index === 0 && <span className="text-lg">👑</span>}
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="font-mono text-sm font-bold">
                          #{game.gameId.slice(0, 6).toUpperCase()}
                        </span>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${phase.bg} ${phase.color}`}>
                        {phase.icon} {game.phase}
                      </span>
                    </div>
                    
                    {/* Stats */}
                    <div className="flex items-center gap-4 mb-4 text-sm">
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <Gamepad2 size={14} />
                        <span>Round <span className="font-bold text-white">{game.round}</span></span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-green-400">🟢</span>
                        <span className="font-bold text-green-400">{game.innocentsAlive}</span>
                      </div>
                      <span className="text-gray-600">vs</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-red-400">🔴</span>
                        <span className="font-bold text-red-400">{game.traitorsAlive}</span>
                      </div>
                    </div>
                    
                    {/* Footer */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-800">
                      <div className="flex items-center gap-1.5 text-gray-500 text-sm">
                        <Eye size={14} />
                        <span>{game.spectators || 0}</span>
                      </div>
                      <span className="bg-red-600 group-hover:bg-red-500 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-1.5">
                        <Play size={14} /> Watch
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 bg-gray-900/50 rounded-2xl border border-gray-800">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <Swords className="w-12 h-12 text-gray-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">No Active Battles</h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">
              The arena is quiet. Check back soon or deploy your agent to start a new game!
            </p>
            <Link 
              href="/"
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 px-6 py-3 rounded-xl font-medium transition-all"
            >
              <ArrowLeft size={18} /> Back to Home
            </Link>
          </div>
        )}

        {/* Quick link to lobby */}
        {games.length > 0 && (
          <div className="mt-8 text-center">
            <Link 
              href="/lobby"
              className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Want to queue up? Go to the Lobby →
            </Link>
          </div>
        )}
      </main>

      {/* Spacer for fixed footer */}
      <div className="h-14" />

      {/* Fixed Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-sm border-t border-gray-800/50 py-3 px-4 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500">
          <span>🎮 Built by</span>
          <a 
            href="https://x.com/OrdinaryWeb3Dev" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 font-medium transition-colors flex items-center gap-1"
          >
            @OrdinaryWeb3Dev
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
        </div>
      </footer>
    </div>
  );
}
