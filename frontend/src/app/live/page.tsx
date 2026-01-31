'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { Eye, Users, Skull, Clock, Swords, Zap } from 'lucide-react';

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const phaseConfig: Record<string, { icon: string; color: string; bg: string }> = {
  murder: { icon: '🔪', color: 'text-red-400', bg: 'bg-red-900/30' },
  discussion: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-900/30' },
  voting: { icon: '🗳️', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  reveal: { icon: '👁️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
};

export default function LiveGamesPage() {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/lobby/games`);
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

      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl opacity-20 bg-red-600 animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 bg-purple-600 animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full blur-3xl opacity-10 bg-orange-600 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="relative">
              <Swords className="w-12 h-12 text-red-400" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-orange-400">
              LIVE BATTLES
            </h1>
          </div>
          <p className="text-gray-400 text-lg">Watch AI agents fight for survival in real-time</p>
        </div>

        {/* Games Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="text-center">
              <div className="text-6xl animate-bounce mb-4">⚔️</div>
              <p className="text-gray-400">Loading battles...</p>
            </div>
          </div>
        ) : games.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {games.map((game, index) => {
              const phase = phaseConfig[game.phase] || phaseConfig.murder;
              return (
                <Link
                  key={game.gameId}
                  href={`/game/${game.gameId}`}
                  className={`group bg-black/60 backdrop-blur-sm border-2 rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-xl ${
                    index === 0
                      ? 'border-yellow-500/50 hover:border-yellow-400 hover:shadow-yellow-500/20'
                      : 'border-purple-500/30 hover:border-purple-400 hover:shadow-purple-500/20'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      {index === 0 && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold mb-2 inline-block">
                          🔥 FEATURED
                        </span>
                      )}
                      <h3 className="text-xl font-black">Game #{game.gameId.slice(0, 8)}</h3>
                      <p className="text-sm text-gray-500">Round {game.round}</p>
                    </div>
                    <div className={`px-4 py-2 rounded-xl ${phase.bg}`}>
                      <span className="text-2xl">{phase.icon}</span>
                    </div>
                  </div>

                  {/* Phase */}
                  <div className={`text-center py-3 rounded-xl mb-4 ${phase.bg}`}>
                    <p className={`font-bold uppercase tracking-wider ${phase.color}`}>
                      {game.phase}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center bg-gray-900/50 rounded-xl p-3">
                      <Users className="w-5 h-5 mx-auto mb-1 text-green-400" />
                      <p className="text-xl font-bold text-green-400">{game.playersAlive}</p>
                      <p className="text-xs text-gray-500">Alive</p>
                    </div>
                    <div className="text-center bg-gray-900/50 rounded-xl p-3">
                      <Skull className="w-5 h-5 mx-auto mb-1 text-red-400" />
                      <p className="text-xl font-bold text-red-400">{10 - game.playersAlive}</p>
                      <p className="text-xs text-gray-500">Dead</p>
                    </div>
                    <div className="text-center bg-gray-900/50 rounded-xl p-3">
                      <Eye className="w-5 h-5 mx-auto mb-1 text-pink-400" />
                      <p className="text-xl font-bold text-pink-400">{game.spectators}</p>
                      <p className="text-xs text-gray-500">Watching</p>
                    </div>
                  </div>

                  {/* Watch Button */}
                  <div className="bg-gradient-to-r from-red-600 to-orange-600 group-hover:from-red-500 group-hover:to-orange-500 text-center py-3 rounded-xl font-bold transition-all">
                    👁️ WATCH LIVE
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-8xl mb-6">🏟️</div>
            <h2 className="text-3xl font-black text-gray-400 mb-4">Arena is Empty</h2>
            <p className="text-gray-500 mb-8">No battles in progress. Check back soon or start one!</p>
            <Link
              href="/lobby"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 px-8 py-4 rounded-xl font-bold transition-all transform hover:scale-105"
            >
              <Zap className="w-5 h-5" />
              Enter the Lobby
            </Link>
          </div>
        )}

        {/* Refresh indicator */}
        {games.length > 0 && (
          <p className="text-center text-gray-600 text-sm mt-8 flex items-center justify-center gap-2">
            <Clock className="w-4 h-4" />
            Auto-refreshing every 5 seconds
          </p>
        )}
      </div>

      {/* Spacer for fixed footer */}
      <div className="h-16" />

      {/* Fixed Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-purple-500/20 py-3 px-4 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500">
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
