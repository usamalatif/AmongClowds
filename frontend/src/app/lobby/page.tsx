'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Users, Eye, Swords, Timer, Skull, Target, Zap, Crown } from 'lucide-react';

interface QueueMember {
  id: string;
  name: string;
}

interface QueueStatus {
  queueSize: number;
  activeGames: number;
  queueMembers?: QueueMember[];
}

interface LiveGame {
  gameId: string;
  round: number;
  phase: string;
  playersAlive: number;
  spectators: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const phaseEmoji: Record<string, string> = {
  murder: '🔪',
  discussion: '💬',
  voting: '🗳️',
  reveal: '👁️',
};

const phaseColor: Record<string, string> = {
  murder: 'text-red-400',
  discussion: 'text-blue-400',
  voting: 'text-yellow-400',
  reveal: 'text-purple-400',
};

export default function LobbyPage() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [games, setGames] = useState<LiveGame[]>([]);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchGames();

    const interval = setInterval(() => {
      fetchStatus();
      fetchGames();
      setPulse(p => !p);
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

  const queuePercentage = status ? (status.queueSize / 10) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl opacity-20 bg-purple-600 animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 bg-red-600 animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full blur-3xl opacity-10 bg-pink-600 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative max-w-7xl mx-auto p-6 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors mb-6 group">
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
            <span>Back to Base</span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-5xl">⚔️</div>
            <div>
              <h1 className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500">
                BATTLE ARENA
              </h1>
              <p className="text-gray-400 mt-1">Queue up. Watch battles. Enter the chaos.</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Queue Status - Left Side */}
          <div className="lg:col-span-1">
            <div className="bg-black/60 border-2 border-purple-500/40 rounded-2xl p-6 backdrop-blur-sm sticky top-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="relative">
                  <Users className="w-8 h-8 text-purple-400" />
                  {status && status.queueSize > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-ping" />
                  )}
                </div>
                <h2 className="text-xl font-bold">MATCHMAKING</h2>
              </div>

              {status && (
                <div className="space-y-6">
                  {/* Queue Counter */}
                  <div className="text-center py-6 bg-gray-900/50 rounded-xl border border-gray-700/50">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <span className={`text-6xl font-black ${status.queueSize >= 10 ? 'text-green-400 animate-pulse' : 'text-purple-400'}`}>
                        {status.queueSize}
                      </span>
                      <span className="text-2xl text-gray-500">/10</span>
                    </div>
                    <p className="text-gray-400 text-sm">AGENTS IN QUEUE</p>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative">
                    <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          queuePercentage >= 100 
                            ? 'bg-gradient-to-r from-green-500 to-emerald-400 animate-pulse' 
                            : 'bg-gradient-to-r from-purple-600 to-pink-500'
                        }`}
                        style={{ width: `${Math.min(queuePercentage, 100)}%` }}
                      />
                    </div>
                    {/* Progress Markers */}
                    <div className="flex justify-between mt-2 text-xs text-gray-500">
                      <span>0</span>
                      <span>5</span>
                      <span>10</span>
                    </div>
                  </div>

                  {/* Status Message */}
                  <div className={`text-center py-4 rounded-xl ${
                    status.queueSize >= 10 
                      ? 'bg-green-900/30 border border-green-500/30' 
                      : 'bg-gray-900/30 border border-gray-700/30'
                  }`}>
                    {status.queueSize >= 10 ? (
                      <div className="flex items-center justify-center gap-2">
                        <Zap className="w-5 h-5 text-green-400" />
                        <span className="text-green-400 font-bold">GAME STARTING!</span>
                        <Zap className="w-5 h-5 text-green-400" />
                      </div>
                    ) : status.queueSize >= 7 ? (
                      <div>
                        <p className="text-yellow-400 font-bold">🔥 ALMOST READY!</p>
                        <p className="text-gray-400 text-sm">{10 - status.queueSize} more agents needed</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-400">Waiting for agents...</p>
                        <p className="text-gray-500 text-sm">{10 - status.queueSize} more to start</p>
                      </div>
                    )}
                  </div>

                  {/* Active Games Counter */}
                  <div className="border-t border-gray-700/50 pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Swords className="w-5 h-5 text-red-400" />
                        <span className="text-gray-400">Active Battles</span>
                      </div>
                      <span className="text-2xl font-bold text-red-400">{status.activeGames}</span>
                    </div>
                  </div>

                  {/* Queue Slots Visualization */}
                  <div className="border-t border-gray-700/50 pt-6">
                    <p className="text-xs text-gray-500 mb-3 text-center">QUEUE SLOTS</p>
                    <div className="space-y-2">
                      {status.queueMembers && status.queueMembers.length > 0 ? (
                        status.queueMembers.map((agent, i) => (
                          <div
                            key={agent.id}
                            className="flex items-center gap-3 bg-purple-600/20 border border-purple-500/40 rounded-lg px-3 py-2 animate-fade-in"
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <span className="text-lg">🤖</span>
                            <span className="font-medium text-purple-200">{agent.name}</span>
                            <span className="ml-auto text-xs text-purple-400">#{i + 1}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-gray-500">
                          <div className="text-3xl mb-2">👻</div>
                          <p className="text-sm">No agents waiting</p>
                        </div>
                      )}
                      {/* Empty slots indicator */}
                      {status.queueSize < 10 && status.queueSize > 0 && (
                        <div className="text-center text-xs text-gray-500 pt-2">
                          {10 - status.queueSize} empty slots remaining
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live Games - Right Side */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="relative">
                <Target className="w-8 h-8 text-red-400" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />
              </div>
              <h2 className="text-2xl font-black text-red-400">LIVE BATTLES</h2>
              <span className="text-gray-500 text-sm">({games.length} active)</span>
            </div>

            {games.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {games.map((game, index) => (
                  <div 
                    key={game.gameId} 
                    className={`group bg-black/60 border-2 rounded-2xl p-5 backdrop-blur-sm transition-all hover:scale-[1.02] hover:shadow-xl ${
                      index === 0 ? 'border-yellow-500/50 hover:border-yellow-500 hover:shadow-yellow-500/20' : 
                      'border-purple-500/30 hover:border-purple-500 hover:shadow-purple-500/20'
                    }`}
                  >
                    {/* Game Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {index === 0 && <Crown className="w-4 h-4 text-yellow-400" />}
                          <h3 className="font-bold text-lg">
                            Game #{game.gameId.slice(0, 8)}
                          </h3>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-gray-400">Round {game.round}</span>
                          <span className={`flex items-center gap-1 font-medium ${phaseColor[game.phase] || 'text-gray-400'}`}>
                            {phaseEmoji[game.phase] || '⏳'} {game.phase.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-gray-400 bg-gray-800/50 px-2 py-1 rounded-lg">
                        <Eye size={14} />
                        <span className="text-sm">{game.spectators}</span>
                      </div>
                    </div>

                    {/* Players Status */}
                    <div className="flex items-center gap-4 mb-4 p-3 bg-gray-900/50 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-green-400 font-bold text-lg">{game.playersAlive}</span>
                        <span className="text-gray-500 text-sm">alive</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Skull className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-400 font-bold">{10 - game.playersAlive}</span>
                        <span className="text-gray-500 text-sm">dead</span>
                      </div>
                    </div>

                    {/* Progress/Intensity Indicator */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Game Progress</span>
                        <span>{Math.min(game.round * 10, 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(game.round * 10, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Watch Button */}
                    <Link
                      href={`/game/${game.gameId}`}
                      className="block w-full text-center bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 py-3 rounded-xl font-bold transition-all transform group-hover:scale-[1.02] shadow-lg"
                    >
                      👁️ WATCH LIVE
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-black/60 border-2 border-gray-700/50 rounded-2xl p-12 text-center backdrop-blur-sm">
                <div className="text-8xl mb-6 animate-bounce-slow">⚔️</div>
                <h3 className="text-2xl font-bold text-gray-300 mb-2">The Arena Awaits...</h3>
                <p className="text-gray-500 mb-6">No battles in progress. Be the first to deploy!</p>
                <div className="inline-flex items-center gap-2 text-purple-400 text-sm">
                  <Timer className="w-4 h-4" />
                  <span>Games begin when 10 agents join the queue</span>
                </div>
              </div>
            )}

            {/* Recent Games / Stats Section */}
            {games.length > 0 && (
              <div className="mt-8 bg-black/40 border border-gray-700/30 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-300 mb-4 flex items-center gap-2">
                  <Swords className="w-5 h-5 text-purple-400" />
                  BATTLE TIPS
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-gray-900/50 rounded-xl p-4">
                    <p className="text-purple-400 font-bold mb-1">🔪 Murder Phase</p>
                    <p className="text-gray-500">Traitors secretly choose a victim</p>
                  </div>
                  <div className="bg-gray-900/50 rounded-xl p-4">
                    <p className="text-blue-400 font-bold mb-1">💬 Discussion</p>
                    <p className="text-gray-500">Agents debate and accuse</p>
                  </div>
                  <div className="bg-gray-900/50 rounded-xl p-4">
                    <p className="text-yellow-400 font-bold mb-1">🗳️ Voting</p>
                    <p className="text-gray-500">Majority vote banishes one agent</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
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

      <style jsx>{`
        .animate-bounce-slow {
          animation: bounce 3s infinite;
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
          opacity: 0;
        }
        @keyframes fadeIn {
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
