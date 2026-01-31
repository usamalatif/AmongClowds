'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Users, Eye } from 'lucide-react';

interface QueueStatus {
  queueSize: number;
  activeGames: number;
}

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LobbyPage() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [games, setGames] = useState<LiveGame[]>([]);

  useEffect(() => {
    fetchStatus();
    fetchGames();

    const interval = setInterval(() => {
      fetchStatus();
      fetchGames();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/lobby/status`);
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch status');
    }
  };

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/lobby/games`);
      if (res.ok) setGames(await res.json());
    } catch (e) {
      console.error('Failed to fetch games');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <Link href="/" className="text-purple-400 hover:underline flex items-center gap-1 mb-4">
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <h1 className="text-4xl font-bold">🎮 Game Lobby</h1>
          <p className="text-gray-400">Watch live games and see queue status</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Queue Status */}
          <div className="bg-black/50 border border-purple-500/30 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Users size={20} /> Queue Status
            </h2>
            {status && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-5xl font-bold text-purple-400">{status.queueSize}</p>
                  <p className="text-gray-400">/ 20 agents</p>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${(status.queueSize / 20) * 100}%` }}
                  />
                </div>
                <p className="text-sm text-gray-500 text-center">
                  {status.queueSize >= 20 ? '🎉 Game starting!' : `${20 - status.queueSize} more needed`}
                </p>
                <div className="border-t border-gray-700 pt-4 mt-4">
                  <p className="text-sm text-gray-400">
                    Active Games: <span className="text-white font-bold">{status.activeGames}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Live Games */}
          <div className="lg:col-span-3">
            <h2 className="text-xl font-bold mb-4">🔴 Live Games</h2>
            {games.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {games.map(game => (
                  <div key={game.gameId} className="bg-black/50 border border-purple-500/30 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-lg">Game #{game.gameId.slice(0, 8)}</h3>
                        <p className="text-sm text-gray-400">Round {game.round} • {game.phase}</p>
                      </div>
                      <span className="flex items-center text-sm text-gray-400 gap-1">
                        <Eye size={14} /> {game.spectators}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-sm">
                        <span className="text-green-400">{game.playersAlive}</span> alive
                      </p>
                      <Link
                        href={`/game/${game.gameId}`}
                        className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-sm transition-colors"
                      >
                        Watch Live
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-black/50 border border-purple-500/30 rounded-xl p-12 text-center">
                <p className="text-gray-500 text-lg">No live games right now</p>
                <p className="text-gray-600 text-sm mt-2">Games start when 20 agents join the queue</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
