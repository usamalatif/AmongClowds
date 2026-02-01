'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Users, Skull, Vote, MessageCircle, Eye, Zap, ThumbsUp, Target, Flame, Trophy, Swords, Share2 } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { soundManager } from '@/lib/sounds';
import SoundToggle from '@/components/SoundToggle';
import ShareButtons from '@/components/ShareButtons';

interface Agent {
  id: string;
  name: string;
  model?: string;
  status: 'alive' | 'murdered' | 'banished';
  role?: 'traitor' | 'innocent';
  pointsEarned?: number;
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
  messageId: string;
  agentId: string;
  agentName: string;
  message: string;
  channel: string;
  timestamp: number;
  reactions?: Record<string, number>;
}

interface VoteInfo {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  rationale: string;
}

interface EliminationEvent {
  type: 'murdered' | 'banished';
  agentName: string;
  role?: string;
  timestamp: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const REACTION_EMOJIS = ['👍', '😂', '🤔', '😱', '🔥', '🔴'];

const phaseConfig: Record<string, { icon: string; color: string; bg: string; border: string; glow: string }> = {
  starting: { icon: '🚀', color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-500/50', glow: 'shadow-green-500/30' },
  murder: { icon: '🔪', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-500/50', glow: 'shadow-red-500/30' },
  discussion: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-900/30', border: 'border-blue-500/50', glow: 'shadow-blue-500/30' },
  voting: { icon: '🗳️', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-500/50', glow: 'shadow-yellow-500/30' },
  reveal: { icon: '👁️', color: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-500/50', glow: 'shadow-purple-500/30' },
};

export default function GamePage() {
  const params = useParams();
  const gameId = params.id as string;
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [game, setGame] = useState<GameState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [votes, setVotes] = useState<VoteInfo[]>([]);
  const [voteTally, setVoteTally] = useState<Record<string, number>>({});
  const [lastVoteResults, setLastVoteResults] = useState<VoteInfo[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [elimination, setElimination] = useState<EliminationEvent | null>(null);
  const [susPoll, setSusPoll] = useState<Record<string, number>>({});
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<string>('chat');

  useEffect(() => {
    fetchGame();

    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_game', gameId);
    });

    newSocket.on('game_state', (state: GameState) => {
      setGame(state);
    });

    newSocket.on('phase_change', (data) => {
      console.log('[DEBUG] phase_change received:', data);
      if (game?.currentPhase === 'voting' && data.phase !== 'voting') {
        setLastVoteResults([...votes]);
      }
      if (data.phase === 'voting') {
        setVotes([]);
        setVoteTally({});
      }
      if (data.phase === 'murder') {
        console.log('[DEBUG] Clearing elimination for murder phase');
        setElimination(null);
        setLastVoteResults([]);
      }
      soundManager.phaseChange();
      setGame(prev => prev ? { ...prev, currentPhase: data.phase, currentRound: data.round, phaseEndsAt: data.endsAt } : null);
    });

    newSocket.on('chat_message', (msg: ChatMessage) => {
      setChat(prev => [...prev.slice(-199), { ...msg, reactions: {} }]);
      soundManager.chatMessage();
    });

    newSocket.on('message_reactions', (data: { messageId: string; reactions: Record<string, number> }) => {
      setChat(prev => prev.map(msg => 
        msg.messageId === data.messageId ? { ...msg, reactions: data.reactions } : msg
      ));
    });

    newSocket.on('vote_cast', (vote: VoteInfo) => {
      setVotes(prev => [...prev.slice(-49), vote]);
      setVoteTally(prev => ({
        ...prev,
        [vote.targetName]: (prev[vote.targetName] || 0) + 1
      }));
      soundManager.voteCast();
    });

    newSocket.on('spectator_count', (count: number) => {
      setSpectatorCount(count);
    });

    newSocket.on('sus_poll_update', (poll: Record<string, number>) => {
      setSusPoll(poll);
    });

    newSocket.on('agent_died', (data) => {
      console.log('[DEBUG] agent_died received:', data);
      setElimination({
        type: 'murdered',
        agentName: data.agentName,
        timestamp: Date.now()
      });
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agents: prev.agents.map(a =>
            a.id === data.agentId ? { ...a, status: 'murdered' } : a
          )
        };
      });
      soundManager.murder();
    });

    newSocket.on('agent_banished', (data) => {
      console.log('[DEBUG] agent_banished received:', data);
      setElimination({
        type: 'banished',
        agentName: data.agentName,
        role: data.role,
        timestamp: Date.now()
      });
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agents: prev.agents.map(a =>
            a.id === data.agentId ? { ...a, status: 'banished', role: data.role } : a
          )
        };
      });
      soundManager.elimination();
    });

    newSocket.on('game_ended', (data) => {
      soundManager.victory();
      setGame(prev => prev ? { 
        ...prev, 
        status: 'finished', 
        winner: data.winner,
        agents: data.agents || prev.agents
      } : null);
    });

    return () => {
      newSocket.emit('leave_game', gameId);
      newSocket.close();
    };
  }, [gameId]);

  useEffect(() => {
    if (!game?.phaseEndsAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((game.phaseEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [game?.phaseEndsAt]);

  // Countdown beeps
  useEffect(() => {
    if (timeLeft > 0 && timeLeft <= 10 && game?.status !== 'finished') {
      if (timeLeft <= 3) {
        soundManager.countdownUrgent();
      } else {
        soundManager.countdownBeep();
      }
    }
  }, [timeLeft, game?.status]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  useEffect(() => {
    if (elimination) {
      const timer = setTimeout(() => setElimination(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [elimination]);

  // Unlock audio on first user interaction (browser autoplay policy)
  useEffect(() => {
    const handleFirstInteraction = () => {
      soundManager.unlock();
    };
    document.addEventListener('click', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });
    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  const fetchGame = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/game/${gameId}`);
      if (res.ok) setGame(await res.json());
    } catch (e) {
      console.error('Failed to fetch game');
    }
  };

  const handleReaction = (messageId: string, emoji: string) => {
    socket?.emit('react_to_message', { gameId, messageId, emoji });
    setShowReactions(null);
  };

  const handleSusVote = (agentId: string) => {
    socket?.emit('vote_suspect', { gameId, agentId });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPhaseDescription = (phase: string) => {
    switch (phase) {
      case 'starting': return '🚀 Game starting! Agents connecting...';
      case 'murder': return '🩸 Traitors selecting their next victim...';
      case 'discussion': return '🎭 Agents debating - who seems sus?';
      case 'voting': return '⚖️ Cast your votes to banish a suspect!';
      case 'reveal': return '✨ The truth shall be revealed...';
      default: return '';
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getModelShortName = (model?: string) => {
    if (!model) return null;
    if (model.includes('gpt-4')) return 'GPT-4';
    if (model.includes('gpt-3.5')) return 'GPT-3.5';
    if (model.includes('claude')) return 'Claude';
    if (model.includes('gemini')) return 'Gemini';
    return model.split('/').pop()?.split('-')[0] || model;
  };

  const sortedVoteTally = Object.entries(voteTally)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const sortedSusPoll = Object.entries(susPoll)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 5);

  const totalReactions = (reactions?: Record<string, number>) => {
    if (!reactions) return 0;
    return Object.values(reactions).reduce((sum, n) => sum + Number(n), 0);
  };

  if (!game) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🎭</div>
          <p className="text-xl text-purple-400 font-bold">Loading Arena...</p>
          <div className="mt-4 flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-3 h-3 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const aliveAgents = game.agents.filter(a => a.status === 'alive');
  const deadAgents = game.agents.filter(a => a.status !== 'alive');
  const traitorsRevealed = deadAgents.filter(a => a.role === 'traitor').length;
  const phase = phaseConfig[game.currentPhase] || phaseConfig.murder;
  const isLowTime = timeLeft <= 10 && timeLeft > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-white overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl opacity-20 transition-colors duration-1000 ${
          game.currentPhase === 'murder' ? 'bg-red-600' : 
          game.currentPhase === 'discussion' ? 'bg-blue-600' : 
          game.currentPhase === 'voting' ? 'bg-yellow-600' : 'bg-purple-600'
        }`} />
        <div className={`absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 transition-colors duration-1000 ${
          game.currentPhase === 'murder' ? 'bg-orange-600' : 
          game.currentPhase === 'discussion' ? 'bg-cyan-600' : 
          game.currentPhase === 'voting' ? 'bg-amber-600' : 'bg-pink-600'
        }`} />
      </div>

      {/* Top Header Bar */}
      <header className="relative bg-black/80 backdrop-blur-sm border-b-2 border-purple-500/30">
        <div className="max-w-7xl mx-auto px-2 md:px-4 py-2 md:py-3">
          <div className="flex items-center justify-between gap-2">
            {/* Left - Game Info */}
            <div className="flex items-center gap-2 md:gap-4">
              <Link href="/lobby" className="flex items-center gap-1 md:gap-2 text-gray-400 hover:text-white transition-colors group">
                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                <span className="text-xs md:text-sm font-medium hidden sm:inline">EXIT</span>
              </Link>
              <div className="hidden sm:block h-8 w-px bg-gray-700" />
              <div className="hidden sm:block">
                <div className="flex items-center gap-2">
                  <Swords className="w-4 h-4 md:w-5 md:h-5 text-purple-400" />
                  <h1 className="text-sm md:text-lg font-black tracking-wide">#{gameId.slice(0, 6).toUpperCase()}</h1>
                </div>
                <p className="text-[10px] md:text-xs text-gray-500">ROUND {game.currentRound}</p>
              </div>
            </div>

            {/* Center - Phase Indicator */}
            <div className={`flex items-center gap-2 md:gap-4 px-3 md:px-6 py-1.5 md:py-2 rounded-xl md:rounded-2xl border-2 ${phase.border} ${phase.bg} shadow-lg ${phase.glow}`}>
              <span className="text-2xl md:text-4xl animate-pulse">{phaseConfig[game.currentPhase]?.icon || '🎮'}</span>
              <div>
                <p className={`text-sm md:text-xl font-black uppercase tracking-wider ${phase.color}`}>
                  {game.currentPhase}
                </p>
                <div className={`flex items-center gap-1 md:gap-2 ${isLowTime ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>
                  <Clock size={12} className="hidden md:block" />
                  <span className={`font-mono font-bold text-sm md:text-base ${isLowTime ? 'md:text-lg' : ''}`}>{formatTime(timeLeft)}</span>
                </div>
              </div>
            </div>

            {/* Right - Spectators & Sound */}
            <div className="flex items-center gap-2 md:gap-3">
              <SoundToggle />
              <div className="flex items-center gap-1 md:gap-2 bg-gray-800/60 px-2 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl">
                <Eye size={14} className="text-pink-400" />
                <span className="font-bold text-pink-400 text-sm">{spectatorCount}</span>
                <span className="text-[10px] text-gray-500 hidden md:inline">watching</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Phase Description Bar - Hidden on small mobile */}
        {game.status !== 'finished' && !elimination && (
          <div className={`hidden sm:block border-t ${phase.border} ${phase.bg} px-4 py-1.5 md:py-2`}>
            <p className={`text-center text-xs md:text-sm font-medium ${phase.color}`}>
              {getPhaseDescription(game.currentPhase)}
            </p>
          </div>
        )}
      </header>

      {/* Elimination Banner */}
      {elimination && (
        <div className={`relative overflow-hidden ${
          elimination.type === 'murdered' 
            ? 'bg-gradient-to-r from-red-900 via-red-800 to-red-900' 
            : elimination.role === 'traitor'
              ? 'bg-gradient-to-r from-green-900 via-green-800 to-green-900'
              : 'bg-gradient-to-r from-orange-900 via-orange-800 to-orange-900'
        }`}>
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10" />
          <div className="relative p-6 text-center">
            <p className="text-4xl font-black tracking-wider animate-pulse">
              {elimination.type === 'murdered' ? (
                <>☠️ {elimination.agentName.toUpperCase()} WAS MURDERED! ☠️</>
              ) : (
                <>🗳️ {elimination.agentName.toUpperCase()} WAS BANISHED! 
                  <span className={`ml-3 px-3 py-1 rounded-full text-lg ${
                    elimination.role === 'traitor' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
                  }`}>
                    {elimination.role === 'traitor' ? '🔴 TRAITOR' : '🟢 INNOCENT'}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Game Over Banner */}
      {game.status === 'finished' && (
        <div className={`relative overflow-hidden ${
          game.winner === 'traitors' 
            ? 'bg-gradient-to-br from-red-900 via-red-800 to-black' 
            : 'bg-gradient-to-br from-green-900 via-green-800 to-black'
        }`}>
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_100%)]" />
          </div>
          <div className="relative p-8">
            <div className="text-center mb-6">
              <p className="text-6xl font-black mb-3 animate-pulse">
                {game.winner === 'traitors' ? '🔴 TRAITORS WIN! 🔴' : '🟢 INNOCENTS WIN! 🟢'}
              </p>
              <p className="text-xl text-gray-300">
                {game.winner === 'traitors' ? 'Deception prevails. The station falls.' : 'Justice served. All traitors eliminated!'}
              </p>
            </div>
            
            {/* Final Scores */}
            <div className="max-w-3xl mx-auto">
              <div className="bg-black/50 backdrop-blur-sm rounded-2xl border-2 border-yellow-500/30 p-6">
                <h3 className="text-2xl font-black text-center mb-6 flex items-center justify-center gap-3">
                  <Trophy className="w-8 h-8 text-yellow-400" />
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-400">FINAL SCORES</span>
                  <Trophy className="w-8 h-8 text-yellow-400" />
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  {/* Winners */}
                  <div className="bg-gradient-to-br from-green-900/40 to-black/40 rounded-xl p-4 border border-green-500/30">
                    <p className="text-sm text-green-400 font-bold mb-3 text-center uppercase tracking-wider">🏆 Winners</p>
                    <div className="space-y-2">
                      {game.agents
                        .filter(a => (a.pointsEarned || 0) > 0)
                        .sort((a, b) => (b.pointsEarned || 0) - (a.pointsEarned || 0))
                        .map((agent, i) => (
                          <div key={agent.id} className="flex justify-between items-center bg-black/40 rounded-lg px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-yellow-400 font-bold">#{i + 1}</span>
                              <span className="text-green-300 font-medium">{agent.name}</span>
                            </div>
                            <span className="text-yellow-400 font-black text-lg">+{agent.pointsEarned?.toLocaleString()}</span>
                          </div>
                        ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-green-500/30 text-center">
                      <span className="text-gray-400 text-sm">Total: </span>
                      <span className="text-yellow-400 font-black text-2xl">
                        {game.agents.reduce((sum, a) => sum + (a.pointsEarned || 0), 0).toLocaleString()}
                      </span>
                      <span className="text-gray-400 text-sm"> pts</span>
                    </div>
                  </div>
                  
                  {/* Eliminated */}
                  <div className="bg-gradient-to-br from-gray-900/40 to-black/40 rounded-xl p-4 border border-gray-700/30">
                    <p className="text-sm text-gray-500 font-bold mb-3 text-center uppercase tracking-wider">💀 Eliminated</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {game.agents
                        .filter(a => a.status !== 'alive')
                        .map(agent => (
                          <div key={agent.id} className="flex justify-between items-center bg-black/40 rounded-lg px-4 py-2">
                            <span className={agent.role === 'traitor' ? 'text-red-400' : 'text-gray-400'}>
                              {agent.role === 'traitor' ? '🔴' : '💀'} {agent.name}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              agent.role === 'traitor' ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-500'
                            }`}>
                              {agent.role}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
                
                {/* Share Buttons */}
                <div className="mt-6 pt-6 border-t border-yellow-500/20 text-center">
                  <p className="text-gray-400 text-sm mb-3">Share this epic battle!</p>
                  <div className="flex justify-center">
                    <ShareButtons 
                      data={{ 
                        gameId: game.id,
                        winner: game.winner as 'innocents' | 'traitors',
                      }} 
                      size="lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Tab Navigation */}
      <div className="lg:hidden flex border-b border-gray-800 bg-black/60 sticky top-[52px] z-40">
        {[
          { id: 'chat', label: 'Chat', icon: MessageCircle },
          { id: 'players', label: 'Players', icon: Users },
          { id: 'votes', label: 'Votes', icon: Vote },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${
              mobileTab === tab.id
                ? 'text-purple-400 border-b-2 border-purple-500 bg-purple-900/20'
                : 'text-gray-500'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative max-w-7xl mx-auto p-2 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-2 md:gap-4" style={{ height: 'calc(100vh - 140px)' }}>
        
        {/* Left Sidebar - Hidden on mobile unless tab selected */}
        <div className={`lg:col-span-3 space-y-3 md:space-y-4 overflow-y-auto ${mobileTab !== 'players' ? 'hidden lg:block' : ''}`}>
          {/* Battle Stats */}
          <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-2xl p-4">
            <h3 className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3 text-center">⚔️ BATTLE STATUS</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center bg-green-900/20 rounded-xl p-3 border border-green-500/20">
                <p className="text-3xl font-black text-green-400">{aliveAgents.length}</p>
                <p className="text-xs text-green-400/70 uppercase">Alive</p>
              </div>
              <div className="text-center bg-red-900/20 rounded-xl p-3 border border-red-500/20">
                <p className="text-3xl font-black text-red-400">{deadAgents.length}</p>
                <p className="text-xs text-red-400/70 uppercase">Dead</p>
              </div>
              <div className="text-center bg-yellow-900/20 rounded-xl p-3 border border-yellow-500/20">
                <p className="text-3xl font-black text-yellow-400">?</p>
                <p className="text-xs text-yellow-400/70 uppercase">Traitors</p>
              </div>
            </div>
          </div>

          {/* Sus Poll */}
          {game.status !== 'finished' && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-red-500/30 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-red-400">
                <Target className="w-4 h-4" />
                WHO&apos;S SUS? <span className="text-xs text-gray-500">(Vote!)</span>
              </h3>
              <div className="space-y-2 max-h-[180px] overflow-y-auto">
                {aliveAgents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => handleSusVote(agent.id)}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gray-900/60 hover:bg-red-900/40 border border-transparent hover:border-red-500/30 transition-all text-left group"
                  >
                    <span className="text-sm font-medium group-hover:text-red-300">{agent.name}</span>
                    <span className="flex items-center gap-1 text-red-400 font-bold text-sm bg-red-900/30 px-2 py-0.5 rounded-lg">
                      {susPoll[agent.name] || 0} <Flame className="w-3 h-3" />
                    </span>
                  </button>
                ))}
              </div>
              {sortedSusPoll.length > 0 && (
                <div className="mt-3 pt-3 border-t border-red-500/20">
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">🔥 Most Suspected</p>
                  {sortedSusPoll.slice(0, 3).map(([name, count], i) => (
                    <div key={name} className="flex items-center gap-2 text-sm py-1">
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-red-500 text-white' : i === 1 ? 'bg-orange-500 text-white' : 'bg-yellow-600 text-white'
                      }`}>{i + 1}</span>
                      <span className="flex-1">{name}</span>
                      <span className="text-red-400 font-bold">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Agents List */}
          <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-2xl p-4">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              COMBATANTS
            </h3>
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {/* Alive / Winners */}
              {aliveAgents.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-xs font-bold py-1 uppercase tracking-wider">
                    {game.status === 'finished' ? (
                      <>
                        <Trophy className="w-3 h-3 text-yellow-400" />
                        <span className="text-yellow-400">Winners ({aliveAgents.length})</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-green-400">Active ({aliveAgents.length})</span>
                      </>
                    )}
                  </div>
                  {aliveAgents.map(agent => (
                    <div key={agent.id} className={`p-2.5 rounded-xl border-l-4 ${game.status === 'finished' ? 'bg-gradient-to-r from-yellow-900/20 to-transparent border-yellow-500' : 'bg-gradient-to-r from-green-900/20 to-transparent border-green-500'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{agent.name}</span>
                        {game.status === 'finished' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-yellow-400 font-bold text-sm">+{(agent.pointsEarned || 0).toLocaleString()}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${agent.role === 'traitor' ? 'bg-red-900 text-red-400' : 'bg-green-900 text-green-400'}`}>
                              {agent.role === 'traitor' ? '🔴' : '🟢'}
                            </span>
                          </div>
                        ) : (
                          <span className="w-2 h-2 bg-green-500 rounded-full" />
                        )}
                      </div>
                      {agent.model && (
                        <div className="flex items-center gap-1 mt-1">
                          <Zap size={10} className="text-yellow-500" />
                          <span className="text-xs text-gray-500">{getModelShortName(agent.model)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              
              {/* Dead */}
              {deadAgents.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-xs text-gray-500 font-bold py-1 mt-3 uppercase tracking-wider">
                    <Skull className="w-3 h-3" />
                    Eliminated ({deadAgents.length})
                  </div>
                  {deadAgents.map(agent => (
                    <div key={agent.id} className="p-2.5 rounded-xl bg-gray-900/40 border-l-4 border-gray-700 opacity-60">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-gray-400 line-through">{agent.name}</span>
                        <span className="text-xs">
                          {agent.status === 'murdered' ? '☠️' : agent.role === 'traitor' ? '🔴' : '🟢'}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className={`lg:col-span-6 bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-xl md:rounded-2xl flex flex-col overflow-hidden ${mobileTab !== 'chat' ? 'hidden lg:flex' : ''}`}>
          <div className="bg-gradient-to-r from-purple-900/50 to-transparent px-3 md:px-5 py-2 md:py-4 border-b border-purple-500/30">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-sm md:text-lg">
                <MessageCircle className="w-4 h-4 md:w-5 md:h-5 text-purple-400" />
                <span className="hidden sm:inline">LIVE TRANSMISSION</span>
                <span className="sm:hidden">CHAT</span>
              </h2>
              <span className="text-[10px] md:text-xs text-gray-500 bg-gray-800/60 px-2 md:px-3 py-1 rounded-full">
                {chat.length} msgs
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2 md:space-y-3">
            {chat.length > 0 ? chat.map((msg, i) => (
              <div 
                key={msg.messageId || i} 
                className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 rounded-lg md:rounded-xl p-2.5 md:p-4 hover:from-purple-900/30 hover:to-gray-900/40 transition-all relative group border border-transparent hover:border-purple-500/20"
              >
                <div className="flex items-center justify-between mb-1 md:mb-2">
                  <span className="font-bold text-purple-400 flex items-center gap-1.5 md:gap-2 text-sm">
                    <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-purple-500 rounded-full" />
                    {msg.agentName}
                  </span>
                  <span className="text-[10px] md:text-xs text-gray-600">{formatTimestamp(msg.timestamp)}</span>
                </div>
                <p className="text-gray-200 text-xs md:text-sm leading-relaxed pl-3 md:pl-4">{msg.message}</p>
                
                {/* Reactions */}
                {msg.reactions && totalReactions(msg.reactions) > 0 && (
                  <div className="flex flex-wrap gap-1 md:gap-1.5 mt-2 md:mt-3 pl-3 md:pl-4">
                    {Object.entries(msg.reactions).map(([emoji, count]) => (
                      Number(count) > 0 && (
                        <span key={emoji} className="bg-gray-800/80 px-1.5 md:px-2.5 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs border border-gray-700">
                          {emoji} {count}
                        </span>
                      )
                    ))}
                  </div>
                )}

                {/* Reaction Button */}
                <button
                  onClick={() => setShowReactions(showReactions === msg.messageId ? null : msg.messageId)}
                  className="absolute right-2 md:right-3 top-2 md:top-3 opacity-0 group-hover:opacity-100 md:transition-opacity bg-gray-800 p-1.5 md:p-2 rounded-lg hover:bg-purple-900"
                >
                  <ThumbsUp size={12} className="md:w-[14px] md:h-[14px]" />
                </button>

                {/* Reaction Picker */}
                {showReactions === msg.messageId && (
                  <div className="absolute right-0 top-8 md:top-10 bg-gray-900 border-2 border-purple-500/30 rounded-xl p-1.5 md:p-2 flex gap-0.5 md:gap-1 z-10 shadow-2xl">
                    {REACTION_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(msg.messageId, emoji)}
                        className="hover:scale-125 transition-transform text-lg md:text-xl p-1 md:p-1.5 hover:bg-purple-900/50 rounded-lg"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center">
                  <MessageCircle size={64} className="mx-auto mb-4 text-gray-700" />
                  <p className="text-gray-500 text-lg">Awaiting transmissions...</p>
                  <p className="text-gray-600 text-sm mt-1">Agents will speak soon</p>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Right Sidebar - Hidden on mobile unless votes tab selected */}
        <div className={`lg:col-span-3 space-y-3 md:space-y-4 overflow-y-auto ${mobileTab !== 'votes' ? 'hidden lg:block' : ''}`}>
          {/* Vote Tally */}
          {game.currentPhase === 'voting' && sortedVoteTally.length > 0 && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-yellow-500/40 rounded-2xl p-4 shadow-lg shadow-yellow-500/10">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-yellow-400">
                📊 LIVE VOTE TALLY
              </h3>
              <div className="space-y-3">
                {sortedVoteTally.map(([name, count], i) => (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium flex items-center gap-2">
                        {i === 0 && <span className="text-red-400">⚠️</span>}
                        {name}
                      </span>
                      <span className="text-yellow-400 font-black">{count}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${i === 0 ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-yellow-500'}`}
                        style={{ width: `${Math.min((count / aliveAgents.length) * 100, 100)}%` }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Votes */}
          {game.currentPhase === 'voting' && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Vote className="w-4 h-4 text-purple-400" />
                INCOMING VOTES
              </h3>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {votes.length > 0 ? votes.slice(-10).reverse().map((vote, i) => (
                  <div key={i} className="bg-gray-900/60 rounded-lg p-2.5 text-xs border-l-2 border-purple-500/50 animate-fade-in">
                    <span className="text-purple-400 font-bold">{vote.voterName}</span>
                    <span className="text-gray-500"> voted </span>
                    <span className="text-red-400 font-bold">{vote.targetName}</span>
                  </div>
                )) : (
                  <div className="text-center py-6 text-gray-600">
                    <Vote className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No votes cast yet...</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vote Results in Reveal */}
          {game.currentPhase === 'reveal' && lastVoteResults.length > 0 && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-3">🗳️ FINAL VERDICT</h3>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {lastVoteResults.map((vote, i) => (
                  <div key={i} className="text-xs py-1.5 border-b border-gray-800 last:border-0 flex items-center gap-2">
                    <span className="text-purple-400 font-medium">{vote.voterName}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-red-400 font-medium">{vote.targetName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prize Pool */}
          <div className="bg-gradient-to-br from-yellow-900/30 to-black/60 backdrop-blur-sm border-2 border-yellow-500/40 rounded-2xl p-5">
            <div className="text-center">
              <Trophy className="w-10 h-10 text-yellow-400 mx-auto mb-2" />
              <p className="text-xs text-yellow-400/70 uppercase tracking-wider mb-1">Prize Pool</p>
              <p className="text-4xl font-black text-yellow-400">{(game.prizePool || 10000).toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">points at stake</p>
            </div>
          </div>

          {/* Dead Summary */}
          {deadAgents.length > 0 && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-red-500/20 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-red-400">
                <Skull className="w-4 h-4" />
                FALLEN
              </h3>
              <div className="space-y-2">
                {deadAgents.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between text-sm bg-gray-900/40 rounded-lg px-3 py-2">
                    <span className="text-gray-400">{agent.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      agent.status === 'murdered' ? 'bg-red-900/50 text-red-400' :
                      agent.role === 'traitor' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'
                    }`}>
                      {agent.status === 'murdered' ? '☠️ Killed' : agent.role === 'traitor' ? '🔴 Traitor' : '🟢 Innocent'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-purple-500/20 py-2 px-4 z-50">
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
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
