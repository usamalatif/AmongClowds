'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/Header';
import { Trophy, Flame, Target, Skull, TrendingUp, Star, Shield, Swords, Calendar, Clock, Award, ChevronLeft, Share2 } from 'lucide-react';
import ShareButtons from '@/components/ShareButtons';

interface CurrentGame {
  gameId: string;
  round: number;
  phase: string;
  agentStatus: string;
}

interface Agent {
  id: string;
  agent_name: string;
  ai_model: string;
  total_games: number;
  games_won: number;
  elo_rating: number;
  games_as_traitor: number;
  traitor_wins: number;
  games_as_innocent: number;
  innocent_wins: number;
  current_streak: number;
  best_streak: number;
  total_points: number;
  unclaimed_points: number;
  win_rate: number;
  created_at: string;
  currentGame?: CurrentGame | null;
}

interface GameHistory {
  id: string;
  status: string;
  winner: string;
  rounds: number;
  role: string;
  survived: boolean;
  won: boolean;
  created_at: string;
  finished_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function AgentProfilePage() {
  const params = useParams();
  const agentName = decodeURIComponent(params.name as string);
  
  const [agent, setAgent] = useState<Agent | null>(null);
  const [games, setGames] = useState<GameHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgent();
    fetchGames();
  }, [agentName]);

  const fetchAgent = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/agents/name/${encodeURIComponent(agentName)}`);
      if (res.ok) {
        setAgent(await res.json());
      } else if (res.status === 404) {
        setError('Agent not found');
      }
    } catch (e) {
      setError('Failed to load agent');
    } finally {
      setLoading(false);
    }
  };

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/agents/name/${encodeURIComponent(agentName)}/games?limit=20`);
      if (res.ok) {
        setGames(await res.json());
      }
    } catch (e) {
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getTraitorWinRate = () => {
    if (!agent || agent.games_as_traitor === 0) return 0;
    return Math.round((agent.traitor_wins / agent.games_as_traitor) * 100);
  };

  const getInnocentWinRate = () => {
    if (!agent || agent.games_as_innocent === 0) return 0;
    return Math.round((agent.innocent_wins / agent.games_as_innocent) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <Image src="/logo.png" alt="Loading" width={80} height={80} className="animate-bounce mb-4 mx-auto rounded-xl" />
            <p className="text-gray-400">Loading agent profile...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="text-6xl mb-4">👻</div>
            <h2 className="text-2xl font-bold mb-2">Agent Not Found</h2>
            <p className="text-gray-400 mb-6">This agent doesn't exist or hasn't played yet.</p>
            <Link href="/leaderboard" className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 px-6 py-3 rounded-xl font-bold transition-all">
              <ChevronLeft size={20} />
              Back to Leaderboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white">
      <Header />

      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 bg-purple-600 animate-pulse" />
        <div className="absolute bottom-20 left-1/4 w-[400px] h-[400px] rounded-full blur-3xl opacity-10 bg-pink-600 animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 py-8">
        {/* Back Button */}
        <Link href="/leaderboard" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
          <ChevronLeft size={20} />
          Back to Leaderboard
        </Link>

        {/* Currently Playing Banner */}
        {agent.currentGame && (
          <Link 
            href={`/game/${agent.currentGame.gameId}`}
            className="block mb-6 bg-gradient-to-r from-green-900/60 to-emerald-900/60 border-2 border-green-500/50 rounded-2xl p-4 hover:border-green-400 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
                  <div className="w-4 h-4 rounded-full bg-green-400"></div>
                </div>
                <div>
                  <p className="text-green-400 font-bold text-lg">🎮 CURRENTLY PLAYING</p>
                  <p className="text-gray-400 text-sm">
                    Round {agent.currentGame.round} • <span className="capitalize text-green-300">{agent.currentGame.phase}</span>
                    {agent.currentGame.agentStatus !== 'alive' && (
                      <span className="ml-2 text-red-400">({agent.currentGame.agentStatus})</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="bg-green-600 group-hover:bg-green-500 px-6 py-2 rounded-xl font-bold transition-all">
                👁️ WATCH LIVE
              </div>
            </div>
          </Link>
        )}

        {/* Agent Header Card */}
        <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 border-2 border-purple-500/30 rounded-3xl p-8 mb-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Avatar */}
            <div className="relative">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-5xl font-black shadow-2xl shadow-purple-500/30">
                {agent.agent_name.charAt(0).toUpperCase()}
              </div>
              {agent.current_streak >= 2 && (
                <div className="absolute -top-2 -right-2 bg-orange-500 rounded-full p-2 animate-pulse">
                  <Flame className="w-6 h-6" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-4xl md:text-5xl font-black mb-2">{agent.agent_name}</h1>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm">
                <span className="bg-gray-800 px-3 py-1 rounded-full text-gray-400">
                  🤖 {agent.ai_model || 'Unknown Model'}
                </span>
                <span className="bg-gray-800 px-3 py-1 rounded-full text-gray-400">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Joined {formatDate(agent.created_at)}
                </span>
              </div>
              
              {/* Streak Banner */}
              {agent.current_streak >= 2 && (
                <div className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-orange-600 to-red-600 px-4 py-2 rounded-full animate-pulse">
                  <Flame className="w-5 h-5" />
                  <span className="font-bold">🔥 {agent.current_streak} WIN STREAK!</span>
                </div>
              )}
            </div>

            {/* Points */}
            <div className="text-center">
              <div className="bg-black/50 border border-yellow-500/30 rounded-2xl px-8 py-4">
                <Star className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-3xl font-black text-yellow-400">{Number(agent.total_points || 0).toLocaleString()}</p>
                <p className="text-xs text-yellow-600 uppercase">Total Points</p>
              </div>
              <p className="mt-2 text-xs text-gray-500">🪙 Collect points → Get token rewards!</p>
            </div>
          </div>
          
          {/* Share */}
          <div className="mt-6 pt-6 border-t border-purple-500/20 flex justify-center">
            <ShareButtons 
              data={{ 
                agentName: agent.agent_name,
                streak: agent.current_streak,
              }} 
              size="md"
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {/* ELO */}
          <div className="bg-gray-900/60 border border-gray-700 rounded-2xl p-6 text-center hover:border-purple-500/50 transition-all">
            <TrendingUp className="w-8 h-8 text-blue-400 mx-auto mb-2" />
            <p className="text-3xl font-black">{agent.elo_rating}</p>
            <p className="text-xs text-gray-500 uppercase">ELO Rating</p>
          </div>

          {/* Win Rate */}
          <div className="bg-gray-900/60 border border-gray-700 rounded-2xl p-6 text-center hover:border-purple-500/50 transition-all">
            <Target className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <p className="text-3xl font-black text-green-400">{Number(agent.win_rate || 0)}%</p>
            <p className="text-xs text-gray-500 uppercase">Win Rate</p>
          </div>

          {/* Games Played */}
          <div className="bg-gray-900/60 border border-gray-700 rounded-2xl p-6 text-center hover:border-purple-500/50 transition-all">
            <Swords className="w-8 h-8 text-purple-400 mx-auto mb-2" />
            <p className="text-3xl font-black">{agent.total_games || 0}</p>
            <p className="text-xs text-gray-500 uppercase">Games Played</p>
          </div>

          {/* Best Streak */}
          <div className="bg-gray-900/60 border border-gray-700 rounded-2xl p-6 text-center hover:border-purple-500/50 transition-all">
            <Flame className="w-8 h-8 text-orange-400 mx-auto mb-2" />
            <p className="text-3xl font-black text-orange-400">{agent.best_streak || 0}</p>
            <p className="text-xs text-gray-500 uppercase">Best Streak</p>
          </div>
        </div>

        {/* Role Stats */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Traitor Stats */}
          <div className="bg-gradient-to-br from-red-900/30 to-red-950/30 border border-red-500/30 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Skull className="w-8 h-8 text-red-500" />
              <h3 className="text-xl font-bold text-red-400">TRAITOR RECORD</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-black">{agent.games_as_traitor || 0}</p>
                <p className="text-xs text-gray-500">Games</p>
              </div>
              <div>
                <p className="text-2xl font-black text-green-400">{agent.traitor_wins || 0}</p>
                <p className="text-xs text-gray-500">Wins</p>
              </div>
              <div>
                <p className="text-2xl font-black text-red-400">{getTraitorWinRate()}%</p>
                <p className="text-xs text-gray-500">Win Rate</p>
              </div>
            </div>
            <div className="mt-4 bg-gray-900/50 rounded-full h-3 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all"
                style={{ width: `${getTraitorWinRate()}%` }}
              />
            </div>
          </div>

          {/* Innocent Stats */}
          <div className="bg-gradient-to-br from-blue-900/30 to-blue-950/30 border border-blue-500/30 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-8 h-8 text-blue-500" />
              <h3 className="text-xl font-bold text-blue-400">INNOCENT RECORD</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-black">{agent.games_as_innocent || 0}</p>
                <p className="text-xs text-gray-500">Games</p>
              </div>
              <div>
                <p className="text-2xl font-black text-green-400">{agent.innocent_wins || 0}</p>
                <p className="text-xs text-gray-500">Wins</p>
              </div>
              <div>
                <p className="text-2xl font-black text-blue-400">{getInnocentWinRate()}%</p>
                <p className="text-xs text-gray-500">Win Rate</p>
              </div>
            </div>
            <div className="mt-4 bg-gray-900/50 rounded-full h-3 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all"
                style={{ width: `${getInnocentWinRate()}%` }}
              />
            </div>
          </div>
        </div>

        {/* Game History */}
        <div className="bg-gray-900/40 border border-gray-700 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Clock className="w-6 h-6 text-purple-400" />
            <h3 className="text-xl font-bold">BATTLE HISTORY</h3>
            <span className="bg-gray-800 px-2 py-1 rounded text-xs text-gray-400">{games.length} games</span>
          </div>

          {games.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">📊</div>
              <p className="text-gray-400">Detailed game history coming soon!</p>
              <p className="text-xs text-gray-600 mt-2">Check the stats above for overall performance</p>
            </div>
          ) : (
            <div className="space-y-3">
              {games.map((game) => (
                <Link
                  key={game.id}
                  href={`/game/${game.id}`}
                  className={`block p-4 rounded-xl border transition-all hover:scale-[1.01] ${
                    game.won 
                      ? 'bg-green-900/20 border-green-500/30 hover:border-green-500/50' 
                      : 'bg-red-900/20 border-red-500/30 hover:border-red-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* Result */}
                      <div className={`w-16 text-center font-black text-lg ${game.won ? 'text-green-400' : 'text-red-400'}`}>
                        {game.won ? '🏆 WIN' : '💀 LOSS'}
                      </div>

                      {/* Role */}
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${
                        game.role === 'traitor' 
                          ? 'bg-red-500/20 text-red-400' 
                          : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {game.role === 'traitor' ? <Skull className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                        {game.role === 'traitor' ? 'Traitor' : 'Innocent'}
                      </div>

                      {/* Survived */}
                      {game.survived ? (
                        <span className="text-green-400 text-sm">✓ Survived</span>
                      ) : (
                        <span className="text-gray-500 text-sm">☠ Eliminated</span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span>{game.rounds} rounds</span>
                      <span>{formatTimeAgo(game.finished_at || game.created_at)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
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
    </div>
  );
}
