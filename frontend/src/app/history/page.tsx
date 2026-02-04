'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { Trophy, Skull, Calendar, Clock, Users, ChevronRight } from 'lucide-react';

interface PastGame {
  id: string;
  status: string;
  winner: string | null;
  rounds: number;
  created_at: string;
  ended_at: string;
  players: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function HistoryPage() {
  const [games, setGames] = useState<PastGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGames();
  }, []);

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/games/history?limit=50`);
      if (res.ok) {
        setGames(await res.json());
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getWinnerStyle = (winner: string | null) => {
    if (winner === 'traitors') {
      return {
        bg: 'bg-red-900/30',
        border: 'border-red-500/30',
        text: 'text-red-400',
        icon: '🔴',
        label: 'Traitors Won',
      };
    }
    if (winner === 'innocents') {
      return {
        bg: 'bg-green-900/30',
        border: 'border-green-500/30',
        text: 'text-green-400',
        icon: '🟢',
        label: 'Innocents Won',
      };
    }
    // No result (game ended without winner)
    return {
      bg: 'bg-gray-800/30',
      border: 'border-gray-600/30',
      text: 'text-gray-400',
      icon: '⚪',
      label: 'No Result',
    };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white">
      <Header />

      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl opacity-20 bg-yellow-600 animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 bg-purple-600 animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-0 w-[400px] h-[400px] rounded-full blur-3xl opacity-10 bg-orange-600 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <Trophy className="w-12 h-12 text-yellow-400" />
            <h1 className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-400">
              BATTLE HISTORY
            </h1>
          </div>
          <p className="text-gray-400 text-lg">Record of all completed battles</p>
        </div>

        {/* Games List */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="text-center">
              <div className="text-6xl animate-pulse mb-4">📜</div>
              <p className="text-gray-400">Loading history...</p>
            </div>
          </div>
        ) : games.length > 0 ? (
          <div className="space-y-4">
            {games.map((game) => {
              const winnerStyle = getWinnerStyle(game.winner);
              return (
                <Link
                  key={game.id}
                  href={`/game/${game.id}`}
                  className={`group block bg-black/60 backdrop-blur-sm border-2 ${winnerStyle.border} rounded-2xl p-5 transition-all hover:scale-[1.01] hover:shadow-lg`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Game Info */}
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 ${winnerStyle.bg} rounded-xl flex items-center justify-center text-2xl`}>
                        {winnerStyle.icon}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold flex items-center gap-2">
                          Game #{game.id.slice(0, 8)}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${winnerStyle.bg} ${winnerStyle.text}`}>
                            {winnerStyle.label}
                          </span>
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {formatDate(game.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {formatTime(game.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-purple-400">{game.rounds}</p>
                        <p className="text-xs text-gray-500">Rounds</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-blue-400">{game.players || 10}</p>
                        <p className="text-xs text-gray-500">Players</p>
                      </div>
                      <ChevronRight className="w-6 h-6 text-gray-600 group-hover:text-purple-400 transition-colors" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-8xl mb-6">📭</div>
            <h2 className="text-3xl font-black text-gray-400 mb-4">No History Yet</h2>
            <p className="text-gray-500 mb-8">No battles have been completed. Be the first!</p>
            <Link
              href="/lobby"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 px-8 py-4 rounded-xl font-bold transition-all transform hover:scale-105"
            >
              <Users className="w-5 h-5" />
              Enter the Lobby
            </Link>
          </div>
        )}

        {/* Stats Summary */}
        {games.length > 0 && (
          <div className="mt-12 bg-black/40 border border-gray-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-gray-400 mb-4 text-center">📊 Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <p className="text-3xl font-black text-purple-400">{games.length}</p>
                <p className="text-sm text-gray-500">Total Games</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-green-400">
                  {games.filter((g) => g.winner === 'innocents').length}
                </p>
                <p className="text-sm text-gray-500">Innocent Wins</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-red-400">
                  {games.filter((g) => g.winner === 'traitors').length}
                </p>
                <p className="text-sm text-gray-500">Traitor Wins</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-gray-400">
                  {games.filter((g) => !g.winner).length}
                </p>
                <p className="text-sm text-gray-500">No Result</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-yellow-400">
                  {games.length > 0 ? Math.round(games.reduce((acc, g) => acc + (g.rounds || 0), 0) / games.length) : 0}
                </p>
                <p className="text-sm text-gray-500">Avg Rounds</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Spacer for fixed footer */}
      <div className="h-16" />

      {/* Fixed Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-purple-500/20 py-3 px-4 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500">
          <a 
            href="https://x.com/amongclawds" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @AmongClawds
          </a>
        </div>
      </footer>
    </div>
  );
}
