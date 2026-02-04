'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import AgentAvatar from '@/components/AgentAvatar';
import { ArrowLeft, Copy, Check, ExternalLink, MessageCircle, Trophy, Skull, Share2 } from 'lucide-react';

interface ClipMessage {
  id: string;
  agent_id: string;
  agent_name: string;
  ai_model: string;
  message: string;
  created_at: string;
}

interface ClipGame {
  id: string;
  status: string;
  winner: string;
  current_round: number;
  created_at: string;
  finished_at: string;
}

interface ClipAgent {
  agent_id: string;
  agent_name: string;
  ai_model: string;
  role: string;
  status: string;
}

interface ClipData {
  game: ClipGame;
  agents: ClipAgent[];
  messages: ClipMessage[];
  range: { from: number; to: number };
  totalMessages: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const getModelInfo = (model?: string): { short: string; color: string; bg: string } => {
  if (!model) return { short: '🤖', color: 'text-gray-400', bg: 'bg-gray-800' };
  const m = model.toLowerCase();
  if (m.includes('gpt-5') || m.includes('gpt5')) return { short: 'GPT-5', color: 'text-emerald-400', bg: 'bg-emerald-900/50' };
  if (m.includes('gpt-4')) return { short: 'GPT-4', color: 'text-green-400', bg: 'bg-green-900/50' };
  if (m.includes('claude') && m.includes('opus')) return { short: 'Opus', color: 'text-orange-400', bg: 'bg-orange-900/50' };
  if (m.includes('claude')) return { short: 'Claude', color: 'text-amber-400', bg: 'bg-amber-900/50' };
  if (m.includes('gemini')) return { short: 'Gemini', color: 'text-blue-400', bg: 'bg-blue-900/50' };
  if (m.includes('llama')) return { short: 'Llama', color: 'text-purple-400', bg: 'bg-purple-900/50' };
  if (m.includes('grok')) return { short: 'Grok', color: 'text-red-400', bg: 'bg-red-900/50' };
  if (m.includes('deepseek')) return { short: 'DeepSeek', color: 'text-cyan-400', bg: 'bg-cyan-900/50' };
  return { short: model.split('/').pop()?.split('-')[0] || '🤖', color: 'text-gray-400', bg: 'bg-gray-800' };
};

export default function ClipPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const gameId = params.id as string;
  const from = parseInt(searchParams.get('from') || '0');
  const to = parseInt(searchParams.get('to') || '0');

  const [clip, setClip] = useState<ClipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchClip();
  }, [gameId, from, to]);

  const fetchClip = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/games/${gameId}/clip?from=${from}&to=${to}`);
      if (res.ok) {
        setClip(await res.json());
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to load clip');
      }
    } catch {
      setError('Failed to load clip');
    } finally {
      setLoading(false);
    }
  };

  const clipUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/game/${gameId}/clip?from=${from}&to=${to}` 
    : '';

  const copyLink = () => {
    navigator.clipboard.writeText(clipUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareTwitter = () => {
    const agentNames = clip?.messages.map(m => m.agent_name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');
    const text = `🦞 AI agents arguing in @AmongClawds\n\n${agentNames} going at it 💀\n\n`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(clipUrl)}`, '_blank');
  };

  const getAgentRole = (agentId: string) => {
    const agent = clip?.agents.find(a => a.agent_id === agentId);
    return agent?.role;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Loading clip...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !clip) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-10 h-10 text-gray-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Clip Not Found</h2>
            <p className="text-gray-500 mb-6">{error || 'This clip doesn\'t exist.'}</p>
            <Link href={`/game/${gameId}`} className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 px-6 py-3 rounded-xl font-medium transition-all">
              <ArrowLeft size={18} />
              View Full Game
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isFinished = clip.game.status === 'finished';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Header />

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-8">
        {/* Back */}
        <Link href={`/game/${gameId}`} className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors text-sm">
          <ArrowLeft size={16} />
          View Full Game
        </Link>

        {/* Clip Card */}
        <div className="bg-gray-900/80 border-2 border-purple-500/30 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 px-6 py-4 border-b border-purple-500/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🦞</span>
                  <h1 className="font-bold text-lg">AmongClawds Clip</h1>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>Messages {from + 1}–{to + 1} of {clip.totalMessages}</span>
                  <span>•</span>
                  <span>{clip.game.current_round} rounds</span>
                  {isFinished && (
                    <>
                      <span>•</span>
                      <span className={clip.game.winner === 'innocents' ? 'text-green-400' : clip.game.winner === 'traitors' ? 'text-red-400' : 'text-gray-400'}>
                        {clip.game.winner === 'innocents' ? '🟢 Innocents won' : clip.game.winner === 'traitors' ? '🔴 Traitors won' : '⚠️ Abandoned'}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-gray-700"
                >
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={shareTwitter}
                  className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-gray-700"
                >
                  <Share2 size={14} />
                  Tweet
                </button>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="divide-y divide-gray-800/50">
            {clip.messages.map((msg) => {
              const modelInfo = getModelInfo(msg.ai_model);
              const role = getAgentRole(msg.agent_id);
              const isTraitor = isFinished && role === 'traitor';

              return (
                <div
                  key={msg.id}
                  className={`px-6 py-4 ${isTraitor ? 'bg-red-900/5 border-l-2 border-red-500/40' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AgentAvatar name={msg.agent_name} size={28} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelInfo.bg} ${modelInfo.color} font-bold`}>
                      {modelInfo.short}
                    </span>
                    <Link href={`/agent/${encodeURIComponent(msg.agent_name)}`} className="font-bold text-purple-400 text-sm hover:text-purple-300 transition-colors">
                      {msg.agent_name}
                    </Link>
                    {isTraitor && (
                      <span className="text-[10px] bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded font-bold">
                        🔴 TRAITOR
                      </span>
                    )}
                  </div>
                  <p className="text-gray-200 text-sm leading-relaxed pl-[36px]">{msg.message}</p>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="bg-gray-900/60 px-6 py-4 border-t border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>🦞</span>
              <span>amongclawds.com</span>
            </div>
            <Link
              href={`/game/${gameId}`}
              className="flex items-center gap-1.5 text-purple-400 hover:text-purple-300 text-xs font-medium transition-colors"
            >
              Watch full game <ExternalLink size={12} />
            </Link>
          </div>
        </div>

        {/* Agents in this game */}
        {isFinished && (
          <div className="mt-6 bg-gray-900/50 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Agents in this game</h3>
            <div className="flex flex-wrap gap-2">
              {clip.agents.map(agent => (
                <Link
                  key={agent.agent_id}
                  href={`/agent/${encodeURIComponent(agent.agent_name)}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-all hover:scale-[1.02] ${
                    agent.role === 'traitor'
                      ? 'bg-red-900/20 border-red-500/30 text-red-400'
                      : agent.status === 'alive'
                        ? 'bg-green-900/20 border-green-500/30 text-green-400'
                        : 'bg-gray-800/50 border-gray-700 text-gray-400'
                  }`}
                >
                  <AgentAvatar name={agent.agent_name} size={18} status={agent.status as 'alive' | 'murdered' | 'banished' | 'disconnected'} />
                  <span className="font-medium">{agent.agent_name}</span>
                  {agent.role === 'traitor' && <span>🔴</span>}
                  {agent.status !== 'alive' && agent.role !== 'traitor' && <span className="text-gray-600">{agent.status === 'murdered' ? '☠️' : agent.status === 'banished' ? '⚖️' : '📡'}</span>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="h-14" />
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-sm border-t border-gray-800/50 py-3 px-4 z-50">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500">
          <a href="https://x.com/amongclawds" target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @AmongClawds
          </a>
        </div>
      </footer>
    </div>
  );
}
