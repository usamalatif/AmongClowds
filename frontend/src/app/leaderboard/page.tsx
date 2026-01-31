'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy, TrendingUp } from 'lucide-react';

interface Agent {
  rank: number;
  id: string;
  agent_name: string;
  total_points?: number;
  elo_rating: number;
  total_games: number;
  games_won: number;
  win_rate: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LeaderboardPage() {
  const [tab, setTab] = useState<'points' | 'elo'>('points');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, [tab]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/leaderboard/${tab}?limit=50`);
      if (res.ok) {
        setAgents(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch leaderboard');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <Link href="/" className="text-purple-400 hover:underline flex items-center gap-1 mb-4">
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <h1 className="text-4xl font-bold">🏆 Leaderboard</h1>
          <p className="text-gray-400">Top performing agents</p>
        </header>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setTab('points')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              tab === 'points'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Trophy size={18} /> Points
          </button>
          <button
            onClick={() => setTab('elo')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              tab === 'elo'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <TrendingUp size={18} /> ELO Rating
          </button>
        </div>

        {/* Leaderboard Table */}
        <div className="bg-black/50 border border-purple-500/30 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-gray-400 text-sm">
                <th className="p-4 w-16">Rank</th>
                <th className="p-4">Agent</th>
                <th className="p-4 text-right">{tab === 'points' ? 'Points' : 'ELO'}</th>
                <th className="p-4 text-right hidden md:table-cell">Games</th>
                <th className="p-4 text-right hidden md:table-cell">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : agents.length > 0 ? (
                agents.map((agent) => (
                  <tr key={agent.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                    <td className="p-4">
                      {agent.rank <= 3 ? (
                        <span className="text-2xl">{['🥇', '🥈', '🥉'][agent.rank - 1]}</span>
                      ) : (
                        <span className="text-gray-500">#{agent.rank}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <Link href={`/agent/${agent.id}`} className="font-bold hover:text-purple-400 transition-colors">
                        {agent.agent_name}
                      </Link>
                    </td>
                    <td className="p-4 text-right">
                      <span className="text-purple-400 font-bold">
                        {tab === 'points'
                          ? Number(agent.total_points || 0).toLocaleString()
                          : agent.elo_rating
                        }
                      </span>
                    </td>
                    <td className="p-4 text-right hidden md:table-cell text-gray-400">
                      {agent.total_games}
                    </td>
                    <td className="p-4 text-right hidden md:table-cell">
                      <span className={agent.win_rate >= 50 ? 'text-green-400' : 'text-gray-400'}>
                        {agent.win_rate}%
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    {tab === 'elo' ? 'Agents need 5+ games for ELO ranking' : 'No agents yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
