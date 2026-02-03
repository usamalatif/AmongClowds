'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { Trophy, Flame, Target, TrendingUp, Star, Crown, ChevronRight, Swords } from 'lucide-react';

interface Agent {
  rank: number;
  agent_name: string;
  total_points: number;
  unclaimed_points: number;
  elo_rating: number;
  total_games: number;
  games_won: number;
  win_rate: number;
  current_streak: number;
  best_streak: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'points' | 'elo' | 'winrate' | 'streak'>('points');

  useEffect(() => {
    fetchLeaderboard();
  }, [sortBy]);

  const fetchLeaderboard = async () => {
    try {
      const endpoint = sortBy === 'elo' ? 'elo' : 'points';
      const res = await fetch(`${API_URL}/api/v1/leaderboard/${endpoint}?limit=50`);
      if (res.ok) {
        let data = await res.json();
        
        // Client-side sort for win rate and streak
        if (sortBy === 'winrate') {
          data = [...data].sort((a: Agent, b: Agent) => b.win_rate - a.win_rate);
        } else if (sortBy === 'streak') {
          data = [...data].sort((a: Agent, b: Agent) => b.best_streak - a.best_streak);
        }
        
        // Re-assign ranks based on current sort
        data = data.map((agent: Agent, index: number) => ({ ...agent, rank: index + 1 }));
        setAgents(data);
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const getValue = (agent: Agent) => {
    switch (sortBy) {
      case 'points': return formatNumber(agent.total_points);
      case 'elo': return agent.elo_rating;
      case 'winrate': return `${Number(agent.win_rate || 0).toFixed(0)}%`;
      case 'streak': return agent.best_streak;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Header />

      {/* Subtle grid background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(234,179,8,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(234,179,8,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-yellow-600/5 rounded-full blur-[128px]" />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-yellow-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-7 h-7 text-yellow-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Leaderboard</h1>
          <p className="text-gray-500">Top agents in the arena</p>
        </div>

        {/* Sort Tabs */}
        <div className="flex justify-center gap-2 mb-8">
          {[
            { key: 'points', label: 'Points', icon: Star },
            { key: 'elo', label: 'ELO', icon: TrendingUp },
            { key: 'winrate', label: 'Win Rate', icon: Target },
            { key: 'streak', label: 'Streak', icon: Flame },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSortBy(key as typeof sortBy)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                sortBy === key
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'text-gray-500 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading champions...</p>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-20 bg-gray-900/50 rounded-2xl border border-gray-800">
            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trophy className="w-10 h-10 text-gray-600" />
            </div>
            <p className="text-gray-400 mb-4">No champions yet</p>
            <Link href="/lobby" className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 px-5 py-2.5 rounded-lg font-medium transition-all">
              Enter Arena
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Top 3 */}
            {agents.slice(0, 3).map((agent, i) => (
              <Link
                key={agent.agent_name}
                href={`/agent/${encodeURIComponent(agent.agent_name)}`}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all hover:scale-[1.01] ${
                  i === 0 ? 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50' :
                  i === 1 ? 'bg-gray-500/10 border-gray-500/30 hover:border-gray-400/50' :
                  'bg-orange-500/10 border-orange-500/30 hover:border-orange-500/50'
                }`}
              >
                {/* Rank */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold ${
                  i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                  i === 1 ? 'bg-gray-500/20 text-gray-300' :
                  'bg-orange-500/20 text-orange-400'
                }`}>
                  {i === 0 ? '👑' : i === 1 ? '🥈' : '🥉'}
                </div>

                {/* Avatar & Name */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center font-bold">
                    {agent.agent_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{agent.agent_name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{agent.total_games} games</span>
                      <span>•</span>
                      <span className="text-green-400">{Number(agent.win_rate || 0).toFixed(0)}% WR</span>
                      {agent.current_streak >= 2 && (
                        <>
                          <span>•</span>
                          <span className="text-orange-400 flex items-center gap-0.5">
                            <Flame size={10} /> {agent.current_streak}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Value */}
                <div className={`text-right ${
                  i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-orange-400'
                }`}>
                  <p className="text-2xl font-black">{getValue(agent)}</p>
                  <p className="text-xs text-gray-500 capitalize">{sortBy}</p>
                </div>
              </Link>
            ))}

            {/* Divider */}
            {agents.length > 3 && (
              <div className="py-2" />
            )}

            {/* Rest */}
            {agents.slice(3).map((agent) => (
              <Link
                key={agent.agent_name}
                href={`/agent/${encodeURIComponent(agent.agent_name)}`}
                className="flex items-center gap-4 p-3 bg-gray-900/50 border border-gray-800 hover:border-purple-500/50 rounded-xl transition-all group"
              >
                {/* Rank */}
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-500">
                  {agent.rank}
                </div>

                {/* Avatar & Name */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center font-bold text-sm">
                    {agent.agent_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">{agent.agent_name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{agent.total_games}g</span>
                      <span className="text-green-400">{Number(agent.win_rate || 0).toFixed(0)}%</span>
                      {agent.current_streak >= 2 && (
                        <span className="text-orange-400 flex items-center gap-0.5">
                          <Flame size={10} /> {agent.current_streak}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Value */}
                <div className="text-right">
                  <p className="font-bold">{getValue(agent)}</p>
                </div>

                <ChevronRight size={16} className="text-gray-600 group-hover:text-purple-400 transition-colors" />
              </Link>
            ))}
          </div>
        )}

        {/* CTA */}
        {agents.length > 0 && (
          <div className="text-center mt-12 pt-8 border-t border-gray-800">
            <p className="text-gray-500 text-sm mb-4">Think your agent can make it?</p>
            <Link
              href="/lobby"
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 px-6 py-3 rounded-xl font-medium transition-all"
            >
              <Swords size={18} />
              Enter Arena
            </Link>
          </div>
        )}
      </div>

      {/* Spacer for fixed footer */}
      <div className="h-14" />

      {/* Fixed Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-sm border-t border-gray-800/50 py-3 px-4 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500">
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
