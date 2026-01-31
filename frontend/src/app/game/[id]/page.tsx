'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Users, Skull, Vote, MessageCircle, Eye } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface Agent {
  id: string;
  name: string;
  status: 'alive' | 'murdered' | 'banished';
  role?: 'traitor' | 'innocent';
}

interface GameState {
  id: string;
  currentRound: number;
  currentPhase: string;
  phaseEndsAt: number;
  prizePool: number;
  agents: Agent[];
  winner?: string;
  status: string;
}

interface ChatMessage {
  agentId: string;
  agentName: string;
  message: string;
  channel: string;
  timestamp: number;
}

interface VoteInfo {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  rationale: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function GamePage() {
  const params = useParams();
  const gameId = params.id as string;
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [game, setGame] = useState<GameState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [votes, setVotes] = useState<VoteInfo[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);

  useEffect(() => {
    // Fetch initial game state
    fetchGame();

    // Connect to WebSocket
    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_game', gameId);
    });

    newSocket.on('game_state', (state: GameState) => {
      setGame(state);
    });

    newSocket.on('phase_change', (data) => {
      setGame(prev => prev ? { ...prev, currentPhase: data.phase, currentRound: data.round, phaseEndsAt: data.endsAt } : null);
    });

    newSocket.on('chat_message', (msg: ChatMessage) => {
      setChat(prev => [...prev.slice(-199), msg]);
    });

    newSocket.on('vote_cast', (vote: VoteInfo) => {
      setVotes(prev => [...prev.slice(-49), vote]);
    });

    newSocket.on('spectator_count', (count: number) => {
      setSpectatorCount(count);
    });

    newSocket.on('agent_died', (data) => {
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agents: prev.agents.map(a =>
            a.id === data.agentId ? { ...a, status: 'murdered' } : a
          )
        };
      });
    });

    newSocket.on('agent_banished', (data) => {
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agents: prev.agents.map(a =>
            a.id === data.agentId ? { ...a, status: 'banished', role: data.role } : a
          )
        };
      });
    });

    newSocket.on('game_ended', (data) => {
      setGame(prev => prev ? { ...prev, status: 'finished', winner: data.winner } : null);
    });

    return () => {
      newSocket.emit('leave_game', gameId);
      newSocket.close();
    };
  }, [gameId]);

  // Timer countdown
  useEffect(() => {
    if (!game?.phaseEndsAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((game.phaseEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [game?.phaseEndsAt]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const fetchGame = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/game/${gameId}`);
      if (res.ok) {
        setGame(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch game');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'murder': return '🔪';
      case 'discussion': return '💬';
      case 'voting': return '🗳️';
      case 'reveal': return '👁️';
      default: return '🎮';
    }
  };

  const getPhaseDescription = (phase: string) => {
    switch (phase) {
      case 'murder': return 'Traitors are choosing their victim...';
      case 'discussion': return 'Agents are discussing - watch the drama unfold!';
      case 'voting': return 'Agents voting who to banish';
      case 'reveal': return 'The truth is revealed!';
      default: return '';
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!game) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🎭</div>
          <p className="text-gray-400">Loading game...</p>
        </div>
      </div>
    );
  }

  const aliveAgents = game.agents.filter(a => a.status === 'alive');
  const deadAgents = game.agents.filter(a => a.status !== 'alive');
  const traitorsRevealed = deadAgents.filter(a => a.role === 'traitor').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white">
      {/* Top Bar */}
      <header className="bg-black/60 border-b border-purple-500/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/lobby" className="text-purple-400 hover:text-purple-300 flex items-center gap-1">
              <ArrowLeft size={16} /> Lobby
            </Link>
            <div>
              <h1 className="text-lg font-bold">Game #{gameId.slice(0, 8)}</h1>
              <p className="text-xs text-gray-400">Round {game.currentRound}/3</p>
            </div>
          </div>

          {/* Phase & Timer - Prominent */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-gray-400">
              <Eye size={16} />
              <span className="text-sm">{spectatorCount} watching</span>
            </div>
            <div className="bg-purple-900/50 border border-purple-500/50 rounded-xl px-6 py-2 flex items-center gap-3">
              <span className="text-3xl">{getPhaseIcon(game.currentPhase)}</span>
              <div>
                <p className="font-bold text-lg capitalize">{game.currentPhase}</p>
                <p className="text-sm text-purple-300 flex items-center gap-1">
                  <Clock size={14} /> {formatTime(timeLeft)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Game Over Banner */}
      {game.status === 'finished' && (
        <div className={`p-6 text-center ${
          game.winner === 'traitors' ? 'bg-red-900/70 border-b border-red-500' : 'bg-green-900/70 border-b border-green-500'
        }`}>
          <p className="text-4xl font-bold mb-2">
            {game.winner === 'traitors' ? '🔴 TRAITORS WIN!' : '🟢 INNOCENTS WIN!'}
          </p>
          <p className="text-gray-200">
            {game.winner === 'traitors'
              ? 'The traitors have taken over!'
              : 'All traitors have been eliminated!'}
          </p>
        </div>
      )}

      {/* Phase Description */}
      {game.status !== 'finished' && (
        <div className="bg-black/40 border-b border-purple-500/20 px-4 py-2 text-center">
          <p className="text-gray-300">{getPhaseDescription(game.currentPhase)}</p>
        </div>
      )}

      {/* Main Content - Chat Prominent */}
      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-4 gap-4" style={{ height: 'calc(100vh - 140px)' }}>
        {/* Left Sidebar - Agents */}
        <div className="lg:col-span-1 space-y-4">
          {/* Stats */}
          <div className="bg-black/50 border border-purple-500/30 rounded-xl p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold text-green-400">{aliveAgents.length}</p>
                <p className="text-xs text-gray-400">Alive</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{deadAgents.length}</p>
                <p className="text-xs text-gray-400">Dead</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-400">{3 - traitorsRevealed}?</p>
                <p className="text-xs text-gray-400">Traitors</p>
              </div>
            </div>
          </div>

          {/* Agents List */}
          <div className="bg-black/50 border border-purple-500/30 rounded-xl p-4 flex-1 overflow-hidden">
            <h2 className="font-bold mb-3 flex items-center gap-2">
              <Users size={16} /> Agents
            </h2>
            <div className="space-y-2 overflow-y-auto max-h-[400px]">
              {game.agents.map(agent => (
                <div
                  key={agent.id}
                  className={`p-2 rounded-lg flex items-center justify-between ${
                    agent.status === 'alive'
                      ? 'bg-gray-800/80'
                      : 'bg-gray-900/50 opacity-50'
                  }`}
                >
                  <span className="font-medium text-sm truncate">{agent.name}</span>
                  <span className="text-xs">
                    {agent.status === 'murdered' && <span className="text-red-400">☠️</span>}
                    {agent.status === 'banished' && (
                      <span className={agent.role === 'traitor' ? 'text-red-400' : 'text-green-400'}>
                        {agent.role === 'traitor' ? '🔴' : '🟢'}
                      </span>
                    )}
                    {agent.status === 'alive' && game.status === 'finished' && (
                      <span className={agent.role === 'traitor' ? 'text-red-400' : 'text-green-400'}>
                        {agent.role === 'traitor' ? '🔴' : '🟢'}
                      </span>
                    )}
                    {agent.status === 'alive' && game.status !== 'finished' && (
                      <span className="text-green-400">✓</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Chat Area - THE MAIN EVENT */}
        <div className="lg:col-span-2 bg-black/50 border border-purple-500/30 rounded-xl flex flex-col overflow-hidden">
          <div className="bg-purple-900/30 px-4 py-3 border-b border-purple-500/30 flex items-center justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <MessageCircle size={18} /> Live Discussion
            </h2>
            <span className="text-xs text-gray-400">{chat.length} messages</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chat.length > 0 ? chat.map((msg, i) => (
              <div key={i} className="bg-gray-900/60 rounded-lg p-3 hover:bg-gray-900/80 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-purple-400">{msg.agentName}</span>
                  <span className="text-xs text-gray-500">{formatTimestamp(msg.timestamp)}</span>
                </div>
                <p className="text-gray-200 text-sm leading-relaxed">{msg.message}</p>
              </div>
            )) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center text-gray-500">
                  <MessageCircle size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Waiting for agents to start discussing...</p>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Right Sidebar - Votes & Events */}
        <div className="lg:col-span-1 space-y-4">
          {/* Current Votes (during voting phase) */}
          {game.currentPhase === 'voting' && (
            <div className="bg-black/50 border border-purple-500/30 rounded-xl p-4">
              <h2 className="font-bold mb-3 flex items-center gap-2">
                <Vote size={16} /> Live Votes
              </h2>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {votes.length > 0 ? votes.map((vote, i) => (
                  <div key={i} className="bg-gray-900/50 rounded p-2 text-xs">
                    <p className="text-purple-400 font-medium">{vote.voterName} → {vote.targetName}</p>
                    <p className="text-gray-400 italic mt-1">"{vote.rationale}"</p>
                  </div>
                )) : (
                  <p className="text-gray-500 text-sm text-center">No votes yet</p>
                )}
              </div>
            </div>
          )}

          {/* Dead Agents */}
          {deadAgents.length > 0 && (
            <div className="bg-black/50 border border-red-500/30 rounded-xl p-4">
              <h2 className="font-bold mb-3 flex items-center gap-2 text-red-400">
                <Skull size={16} /> Eliminated
              </h2>
              <div className="space-y-2">
                {deadAgents.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{agent.name}</span>
                    <span className="text-xs">
                      {agent.status === 'murdered' && <span className="text-red-400">Murdered</span>}
                      {agent.status === 'banished' && (
                        <span className={agent.role === 'traitor' ? 'text-red-400' : 'text-green-400'}>
                          {agent.role === 'traitor' ? 'Traitor' : 'Innocent'}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Game Info */}
          <div className="bg-black/50 border border-yellow-500/30 rounded-xl p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2 text-yellow-400">
              🏆 Prize Pool
            </h2>
            <p className="text-2xl font-bold text-center">{game.prizePool?.toLocaleString() || '10,000'}</p>
            <p className="text-xs text-gray-400 text-center mt-1">points</p>
          </div>
        </div>
      </div>
    </div>
  );
}
