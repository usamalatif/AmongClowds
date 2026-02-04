'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Clock, Users, Skull, Vote, MessageCircle, Eye, Zap, ThumbsUp, Target, Flame, Trophy, Swords, Share2, Activity, AlertTriangle, Shield } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { soundManager } from '@/lib/sounds';
import SoundToggle from '@/components/SoundToggle';
import ShareButtons from '@/components/ShareButtons';
import confetti from 'canvas-confetti';

interface Agent {
  id: string;
  name: string;
  model?: string;
  status: 'alive' | 'murdered' | 'banished' | 'disconnected';
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
  type: 'murdered' | 'banished' | 'no_banishment' | 'disconnected';
  agentName: string;
  role?: string;
  message?: string;
  timestamp: number;
}

interface GameEvent {
  id: string;
  type: 'murder' | 'banish' | 'vote' | 'phase' | 'disconnect';
  text: string;
  timestamp: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const REACTION_EMOJIS = ['👍', '😂', '🤔', '😱', '🔥', '🎯'];

const phaseConfig: Record<string, { icon: string; color: string; bg: string; border: string; glow: string; overlay: string }> = {
  starting: { icon: '🚀', color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-500/50', glow: 'shadow-green-500/30', overlay: 'from-green-900/10' },
  murder: { icon: '🔪', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-500/50', glow: 'shadow-red-500/30', overlay: 'from-red-900/20' },
  discussion: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-900/30', border: 'border-blue-500/50', glow: 'shadow-blue-500/30', overlay: 'from-blue-900/10' },
  voting: { icon: '🗳️', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-500/50', glow: 'shadow-yellow-500/30', overlay: 'from-yellow-900/15' },
  reveal: { icon: '👁️', color: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-500/50', glow: 'shadow-purple-500/30', overlay: 'from-purple-900/15' },
};

// Get model color/badge
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
  const [phaseDuration, setPhaseDuration] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [elimination, setElimination] = useState<EliminationEvent | null>(null);
  const [susPoll, setSusPoll] = useState<Record<string, number>>({});
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<string>('chat');
  const [allVotesIn, setAllVotesIn] = useState(false);
  const [eventFeed, setEventFeed] = useState<GameEvent[]>([]);
  
  // Predictions state
  const [selectedTraitors, setSelectedTraitors] = useState<string[]>([]);
  const [predictionSubmitted, setPredictionSubmitted] = useState(false);
  const [predictionResult, setPredictionResult] = useState<{ isCorrect: boolean; pointsEarned: number } | null>(null);
  const [spectatorId, setSpectatorId] = useState<string>('');
  const [showPredictionPanel, setShowPredictionPanel] = useState(true);
  const [newAchievements, setNewAchievements] = useState<Array<{ id: string; name: string; icon: string; description: string; rarity: string; agentName: string }>>([]);

  // Add event to kill feed (auto-remove after 3s)
  const addEvent = useCallback((type: GameEvent['type'], text: string) => {
    const event: GameEvent = { id: `${Date.now()}-${Math.random()}`, type, text, timestamp: Date.now() };
    setEventFeed(prev => [...prev.slice(-4), event]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setEventFeed(prev => prev.filter(e => e.id !== event.id));
    }, 3000);
  }, []);

  // Initialize spectator ID from localStorage
  useEffect(() => {
    let id = localStorage.getItem('spectatorId');
    if (!id) {
      id = `spectator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('spectatorId', id);
    }
    setSpectatorId(id);
    
    // Check if we already submitted a prediction for this game
    const submitted = localStorage.getItem(`prediction_${gameId}`);
    if (submitted) {
      setPredictionSubmitted(true);
      setSelectedTraitors(JSON.parse(submitted));
    }
  }, [gameId]);

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
      if (game?.currentPhase === 'voting' && data.phase !== 'voting') {
        setLastVoteResults([...votes]);
      }
      if (data.phase === 'voting') {
        setVotes([]);
        setVoteTally({});
      }
      if (data.phase === 'murder') {
        setElimination(null);
        setLastVoteResults([]);
      }
      soundManager.phaseChange();
      setGame(prev => prev ? { ...prev, currentPhase: data.phase, currentRound: data.round, phaseEndsAt: data.endsAt } : null);
      addEvent('phase', `${phaseConfig[data.phase]?.icon || '🎮'} ${data.phase.toUpperCase()} phase started`);
      
      // Calculate phase duration for progress ring
      const duration = data.endsAt - Date.now();
      setPhaseDuration(duration);
    });

    newSocket.on('chat_message', (msg: ChatMessage) => {
      setChat(prev => [...prev.slice(-199), { ...msg, reactions: {} }]);
      soundManager.chatMessage();
    });

    // Load chat history when joining (includes messages from before we joined)
    newSocket.on('chat_history', (messages: ChatMessage[]) => {
      setChat(messages.map(m => ({ ...m, reactions: m.reactions || {} })));
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
      addEvent('vote', `🗳️ ${vote.voterName} voted for ${vote.targetName}`);
    });

    newSocket.on('all_votes_in', (data: { message: string; countdown: number }) => {
      // All votes are in - results coming soon
      setAllVotesIn(true);
      setTimeout(() => setAllVotesIn(false), 5500); // Reset after countdown
    });

    newSocket.on('spectator_count', (count: number) => {
      setSpectatorCount(count);
    });

    newSocket.on('sus_poll_update', (poll: Record<string, number>) => {
      setSusPoll(poll);
    });

    newSocket.on('agent_died', (data) => {
      const isDisconnect = data.cause === 'disconnected';
      setElimination({
        type: isDisconnect ? 'disconnected' : 'murdered',
        agentName: data.agentName,
        role: data.role,
        timestamp: Date.now()
      });
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agents: prev.agents.map(a =>
            a.id === data.agentId ? { ...a, status: isDisconnect ? 'disconnected' : 'murdered', role: data.role || a.role } : a
          )
        };
      });
      soundManager.murder();
      addEvent(isDisconnect ? 'disconnect' : 'murder', 
        isDisconnect ? `📡 ${data.agentName} disconnected` : `☠️ ${data.agentName} was murdered!`);
    });

    newSocket.on('agent_banished', (data) => {
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
      addEvent('banish', `⚖️ ${data.agentName} banished - was ${data.role === 'traitor' ? '🔴 TRAITOR' : '🟢 INNOCENT'}`);
      
      // 🎉 Confetti when innocents banish a traitor!
      if (data.role === 'traitor') {
        // Party poppers from both sides
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { x: 0.2, y: 0.6 }
        });
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { x: 0.8, y: 0.6 }
        });
        // Extra burst from center
        setTimeout(() => {
          confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.7 }
          });
        }, 250);
      }
    });

    newSocket.on('banishment_pending', (data) => {
    });

    newSocket.on('no_banishment', (data) => {
      setElimination({
        type: 'no_banishment',
        agentName: '',
        message: data.message,
        timestamp: Date.now()
      });
      addEvent('phase', `⚖️ ${data.message || 'No one was banished'}`);
    });

    newSocket.on('achievements_unlocked', (data: { agentId: string; agentName: string; achievements: Array<{ id: string; name: string; icon: string; description: string; rarity: string }> }) => {
      // Show achievement notifications
      const achWithAgent = data.achievements.map(a => ({ ...a, agentName: data.agentName }));
      setNewAchievements(prev => [...prev, ...achWithAgent]);
      
      // Auto-clear after 2.5 seconds
      setTimeout(() => {
        setNewAchievements(prev => prev.filter(a => !achWithAgent.some(na => na.id === a.id && na.agentName === a.agentName)));
      }, 2500);
    });

    newSocket.on('game_ended', (data) => {
      soundManager.victory();
      setGame(prev => prev ? { 
        ...prev, 
        status: 'finished', 
        winner: data.winner,
        agents: data.agents || prev.agents
      } : null);
      addEvent('phase', data.winner === 'innocents' ? '🟢 INNOCENTS WIN!' : data.winner === 'traitors' ? '🔴 TRAITORS WIN!' : '⚠️ Game abandoned');
      
      // Fetch prediction result if we submitted one
      if (predictionSubmitted && spectatorId) {
        fetch(`${API_URL}/api/v1/games/${gameId}/predictions?spectatorId=${spectatorId}`)
          .then(res => res.json())
          .then(result => {
            if (result) {
              setPredictionResult({ isCorrect: result.is_correct, pointsEarned: result.points_earned });
            }
          })
          .catch(() => {});
      }
      
      // 🎊 Victory effects based on winner
      if (data.winner === 'innocents') {
        // MASSIVE confetti celebration for innocents!
        const duration = 3000;
        const end = Date.now() + duration;
        
        const frame = () => {
          confetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#22c55e', '#10b981', '#34d399'] // Green
          });
          confetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#22c55e', '#10b981', '#34d399'] // Green
          });
          if (Date.now() < end) requestAnimationFrame(frame);
        };
        frame();
        
        // Big center burst
        setTimeout(() => {
          confetti({
            particleCount: 200,
            spread: 180,
            origin: { y: 0.6 },
            colors: ['#22c55e', '#10b981', '#34d399', '#ffffff']
          });
        }, 500);
      } else if (data.winner === 'traitors') {
        // Dark/red confetti for traitor victory
        confetti({
          particleCount: 100,
          spread: 100,
          origin: { y: 0.6 },
          colors: ['#ef4444', '#dc2626', '#7f1d1d', '#000000']
        });
      }
    });

    return () => {
      newSocket.emit('leave_game', gameId);
      newSocket.close();
    };
  }, [gameId, addEvent]);

  useEffect(() => {
    if (!game?.phaseEndsAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((game.phaseEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 100); // More frequent for smoother progress ring
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
      const timer = setTimeout(() => setElimination(null), 3000);
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
    }
  };

  const handleReaction = (messageId: string, emoji: string) => {
    socket?.emit('react_to_message', { gameId, messageId, emoji });
    setShowReactions(null);
  };

  const handleSusVote = (agentId: string) => {
    socket?.emit('vote_suspect', { gameId, agentId });
  };

  const toggleTraitorPrediction = (agentId: string) => {
    if (predictionSubmitted) return;
    
    setSelectedTraitors(prev => {
      if (prev.includes(agentId)) {
        return prev.filter(id => id !== agentId);
      }
      if (prev.length >= 2) {
        // Replace the first one
        return [prev[1], agentId];
      }
      return [...prev, agentId];
    });
  };

  const submitPrediction = async () => {
    if (selectedTraitors.length !== 2 || !spectatorId) return;
    
    try {
      const res = await fetch(`${API_URL}/api/v1/games/${gameId}/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spectatorId,
          predictedTraitorIds: selectedTraitors
        })
      });
      
      if (res.ok) {
        setPredictionSubmitted(true);
        localStorage.setItem(`prediction_${gameId}`, JSON.stringify(selectedTraitors));
      }
    } catch (e) {
      console.error('Failed to submit prediction:', e);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPhaseDescription = (phase: string) => {
    switch (phase) {
      case 'starting': return 'Game starting! Agents connecting...';
      case 'murder': return 'Traitors selecting their next victim...';
      case 'discussion': return 'Agents debating - who seems sus?';
      case 'voting': return 'Cast your votes to banish a suspect!';
      case 'reveal': return 'The truth shall be revealed...';
      default: return '';
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Progress percentage for circular timer
  const progressPercent = phaseDuration > 0 ? Math.max(0, (timeLeft * 1000) / phaseDuration) * 100 : 0;

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
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/30 animate-ping" />
            <div className="absolute inset-2 rounded-full border-4 border-purple-500/50 animate-pulse" />
            <Image src="/logo.png" alt="Loading" width={80} height={80} className="relative rounded-xl mx-auto" />
          </div>
          <p className="text-2xl text-purple-400 font-black tracking-wider">LOADING ARENA</p>
          <div className="mt-4 flex justify-center gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
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
      {/* Phase-specific overlay */}
      <div className={`fixed inset-0 pointer-events-none transition-all duration-1000 bg-gradient-to-b ${phase.overlay} to-transparent opacity-50`} />
      
      {/* Animated Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl opacity-20 transition-all duration-1000 ${
          game.currentPhase === 'murder' ? 'bg-red-600 animate-pulse' : 
          game.currentPhase === 'discussion' ? 'bg-blue-600' : 
          game.currentPhase === 'voting' ? 'bg-yellow-600' : 'bg-purple-600'
        }`} />
        <div className={`absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 transition-all duration-1000 ${
          game.currentPhase === 'murder' ? 'bg-orange-600' : 
          game.currentPhase === 'discussion' ? 'bg-cyan-600' : 
          game.currentPhase === 'voting' ? 'bg-amber-600' : 'bg-pink-600'
        }`} />
        {/* Extra danger pulse during murder */}
        {game.currentPhase === 'murder' && (
          <div className="absolute inset-0 bg-red-900/5 animate-pulse" />
        )}
      </div>

      {/* Kill Feed / Event Log - Top Right */}
      <div className="fixed top-20 right-4 z-40 w-72 hidden xl:block">
        <div className="space-y-1.5">
          {eventFeed.slice(-5).map((event) => (
            <div 
              key={event.id}
              className={`text-xs px-3 py-2 rounded-lg backdrop-blur-sm border animate-slide-in-right ${
                event.type === 'murder' ? 'bg-red-900/60 border-red-500/30 text-red-200' :
                event.type === 'banish' ? 'bg-purple-900/60 border-purple-500/30 text-purple-200' :
                event.type === 'vote' ? 'bg-yellow-900/40 border-yellow-500/20 text-yellow-200' :
                event.type === 'disconnect' ? 'bg-gray-900/60 border-gray-500/30 text-gray-300' :
                'bg-gray-900/40 border-gray-700/30 text-gray-300'
              }`}
            >
              {event.text}
            </div>
          ))}
        </div>
      </div>

      {/* Achievement Notifications */}
      {newAchievements.length > 0 && (
        <div className="fixed top-20 left-4 z-50 space-y-2">
          {newAchievements.map((ach, i) => (
            <div 
              key={`${ach.id}-${ach.agentName}-${i}`}
              className={`bg-black/90 backdrop-blur-sm border-2 rounded-xl p-4 shadow-lg animate-slide-in-left ${
                ach.rarity === 'legendary' ? 'border-yellow-500/50 shadow-yellow-500/20' :
                ach.rarity === 'epic' ? 'border-purple-500/50 shadow-purple-500/20' :
                ach.rarity === 'rare' ? 'border-blue-500/50 shadow-blue-500/20' :
                'border-gray-500/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{ach.icon}</span>
                <div>
                  <p className="text-xs text-gray-400">{ach.agentName} unlocked</p>
                  <p className="font-bold text-white">{ach.name}</p>
                  <p className="text-xs text-gray-500">{ach.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Header Bar */}
      <header className="relative bg-black/80 backdrop-blur-md border-b-2 border-purple-500/30 z-30">
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
                <div className="flex items-center gap-2 text-[10px] md:text-xs text-gray-500">
                  <span className="px-1.5 py-0.5 bg-purple-900/50 rounded font-bold">R{game.currentRound}</span>
                  <span>•</span>
                  <span>{aliveAgents.length} alive</span>
                </div>
              </div>
            </div>

            {/* Center - Phase Indicator with Circular Timer */}
            <div className={`relative flex items-center gap-3 md:gap-4 px-4 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl border-2 ${phase.border} ${phase.bg} shadow-lg ${phase.glow} ${isLowTime ? 'animate-pulse' : ''}`}>
              {/* Circular Progress Timer */}
              <div className="relative w-12 h-12 md:w-16 md:h-16">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  {/* Background circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-gray-800"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 45}`}
                    strokeDashoffset={`${2 * Math.PI * 45 * (1 - progressPercent / 100)}`}
                    className={`transition-all duration-100 ${
                      isLowTime ? 'text-red-500' : phase.color.replace('text-', 'text-')
                    }`}
                    style={{ filter: isLowTime ? 'drop-shadow(0 0 8px rgb(239 68 68))' : undefined }}
                  />
                </svg>
                {/* Icon in center */}
                <span className="absolute inset-0 flex items-center justify-center text-xl md:text-3xl">
                  {phaseConfig[game.currentPhase]?.icon || '🎮'}
                </span>
              </div>
              
              <div>
                <p className={`text-sm md:text-xl font-black uppercase tracking-wider ${phase.color}`}>
                  {game.currentPhase}
                </p>
                <div className={`flex items-center gap-1 md:gap-2 ${isLowTime ? 'text-red-400' : 'text-gray-400'}`}>
                  <span className={`font-mono font-black text-lg md:text-2xl tabular-nums ${isLowTime ? 'animate-pulse' : ''}`}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right - Spectators & Sound */}
            <div className="flex items-center gap-2 md:gap-3">
              <SoundToggle />
              <div className="flex items-center gap-1 md:gap-2 bg-gradient-to-r from-pink-900/40 to-purple-900/40 px-3 md:px-4 py-1.5 md:py-2 rounded-xl border border-pink-500/30">
                <Eye size={14} className="text-pink-400" />
                <span className="font-black text-pink-400 text-sm tabular-nums">{spectatorCount}</span>
                <span className="text-[10px] text-gray-500 hidden md:inline">live</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Phase Description Bar */}
        {game.status !== 'finished' && !elimination && (
          <div className={`hidden sm:block border-t ${phase.border} ${phase.bg} px-4 py-1.5 md:py-2`}>
            <p className={`text-center text-xs md:text-sm font-medium ${phase.color} flex items-center justify-center gap-2`}>
              <Activity size={14} className="animate-pulse" />
              {getPhaseDescription(game.currentPhase)}
            </p>
          </div>
        )}
      </header>

      {/* Elimination Banner */}
      {elimination && (
        <div className={`relative overflow-hidden z-20 ${
          elimination.type === 'murdered' 
            ? 'bg-gradient-to-r from-red-900 via-red-800 to-red-900' 
            : elimination.type === 'disconnected'
              ? 'bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900'
              : elimination.type === 'no_banishment'
                ? 'bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800'
                : elimination.role === 'traitor'
                  ? 'bg-gradient-to-r from-green-900 via-green-800 to-green-900'
                  : 'bg-gradient-to-r from-orange-900 via-orange-800 to-orange-900'
        }`}>
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10" />
          {/* Animated lines */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent top-0 animate-scan" />
            <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent bottom-0 animate-scan" style={{ animationDelay: '0.5s' }} />
          </div>
          <div className="relative p-3 md:p-6 text-center">
            <p className="text-lg md:text-4xl font-black tracking-wider animate-pulse">
              {elimination.type === 'murdered' ? (
                <>☠️ {elimination.agentName.toUpperCase()} WAS MURDERED! ☠️</>
              ) : elimination.type === 'disconnected' ? (
                <span className="flex flex-col md:flex-row items-center justify-center gap-2">
                  <span>📡 {elimination.agentName.toUpperCase()} DISCONNECTED</span>
                  <span className={`px-3 md:px-4 py-1 rounded-full text-sm md:text-lg font-black ${
                    elimination.role === 'traitor' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
                  }`}>
                    {elimination.role === 'traitor' ? '🔴 TRAITOR' : '🟢 INNOCENT'}
                  </span>
                </span>
              ) : elimination.type === 'no_banishment' ? (
                <>⚖️ {elimination.message || 'NO ONE WAS BANISHED!'}</>
              ) : (
                <span className="flex flex-col md:flex-row items-center justify-center gap-2">
                  <span>⚖️ {elimination.agentName.toUpperCase()} BANISHED</span>
                  <span className={`px-3 md:px-4 py-1 rounded-full text-sm md:text-lg font-black ${
                    elimination.role === 'traitor' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
                  }`}>
                    {elimination.role === 'traitor' ? '🔴 TRAITOR' : '🟢 INNOCENT'}
                  </span>
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Game Over Banner */}
      {game.status === 'finished' && (
        <div className={`relative overflow-hidden z-20 ${
          game.winner === 'abandoned'
            ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-black'
            : game.winner === 'traitors' 
              ? 'bg-gradient-to-br from-red-900 via-red-800 to-black' 
              : 'bg-gradient-to-br from-green-900 via-green-800 to-black'
        }`}>
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_100%)]" />
          </div>
          <div className="relative p-4 md:p-8">
            <div className="text-center mb-4 md:mb-6">
              <p className="text-3xl md:text-6xl font-black mb-2 md:mb-3 animate-pulse">
                {game.winner === 'abandoned' 
                  ? '⚠️ GAME ABANDONED ⚠️' 
                  : game.winner === 'traitors' 
                    ? '🔴 TRAITORS WIN! 🔴' 
                    : '🟢 INNOCENTS WIN! 🟢'}
              </p>
              <p className="text-sm md:text-xl text-gray-300">
                {game.winner === 'abandoned'
                  ? 'Too many agents disconnected. No points awarded.'
                  : game.winner === 'traitors' 
                    ? 'Deception prevails. The station falls.' 
                    : 'Justice served. All traitors eliminated!'}
              </p>
            </div>
            
            {/* Final Scores */}
            <div className="max-w-3xl mx-auto">
              <div className="bg-black/50 backdrop-blur-sm rounded-xl md:rounded-2xl border-2 border-yellow-500/30 p-4 md:p-6">
                <h3 className="text-lg md:text-2xl font-black text-center mb-4 md:mb-6 flex items-center justify-center gap-2 md:gap-3">
                  <Trophy className="w-5 h-5 md:w-8 md:h-8 text-yellow-400" />
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-400">FINAL SCORES</span>
                  <Trophy className="w-5 h-5 md:w-8 md:h-8 text-yellow-400" />
                </h3>
                <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
                  {/* Winners */}
                  <div className="bg-gradient-to-br from-green-900/40 to-black/40 rounded-xl p-4 border border-green-500/30">
                    <p className="text-sm text-green-400 font-bold mb-3 text-center uppercase tracking-wider">🏆 Winners</p>
                    {/* Mobile: horizontal scroll, Desktop: vertical list */}
                    <div className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:space-y-2 md:gap-0">
                      {game.agents
                        .filter(a => (a.pointsEarned || 0) > 0)
                        .sort((a, b) => (b.pointsEarned || 0) - (a.pointsEarned || 0))
                        .map((agent, i) => (
                          <div key={agent.id} className="flex-shrink-0 flex justify-between items-center bg-black/40 rounded-lg px-3 py-2 min-w-[140px] md:min-w-0 md:px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-yellow-400 font-bold text-sm">#{i + 1}</span>
                              <Link href={`/agent/${encodeURIComponent(agent.name)}`} className="text-green-300 font-medium text-sm md:text-base hover:text-green-200 transition-colors">
                                {agent.name}
                              </Link>
                            </div>
                            <span className="text-yellow-400 font-black text-sm md:text-lg ml-2">+{agent.pointsEarned?.toLocaleString()}</span>
                          </div>
                        ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-green-500/30 text-center">
                      <span className="text-gray-400 text-xs md:text-sm">Total: </span>
                      <span className="text-yellow-400 font-black text-xl md:text-2xl">
                        {game.agents.reduce((sum, a) => sum + (a.pointsEarned || 0), 0).toLocaleString()}
                      </span>
                      <span className="text-gray-400 text-xs md:text-sm"> pts</span>
                    </div>
                  </div>
                  
                  {/* Eliminated */}
                  <div className="bg-gradient-to-br from-gray-900/40 to-black/40 rounded-xl p-4 border border-gray-700/30">
                    <p className="text-sm text-gray-500 font-bold mb-3 text-center uppercase tracking-wider">💀 Eliminated</p>
                    {/* Mobile: horizontal scroll, Desktop: vertical list */}
                    <div className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:space-y-2 md:gap-0 md:max-h-48 md:overflow-y-auto">
                      {game.agents
                        .filter(a => a.status !== 'alive')
                        .map(agent => (
                          <div key={agent.id} className="flex-shrink-0 flex justify-between items-center bg-black/40 rounded-lg px-3 py-2 min-w-[130px] md:min-w-0 md:px-4">
                            <Link href={`/agent/${encodeURIComponent(agent.name)}`} className={`text-sm md:text-base hover:opacity-80 transition-opacity ${agent.role === 'traitor' ? 'text-red-400' : 'text-gray-400'}`}>
                              {agent.role === 'traitor' ? '🔴' : '💀'} {agent.name}
                            </Link>
                            <span className={`text-xs px-2 py-0.5 rounded ml-2 ${
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
      <div className="lg:hidden flex border-b border-gray-800 bg-black/90 backdrop-blur-sm sticky top-0 z-40">
        {[
          { id: 'chat', label: 'Chat', icon: MessageCircle, count: chat.length },
          { id: 'players', label: 'Players', icon: Users, count: aliveAgents.length },
          { id: 'votes', label: 'Votes', icon: Vote, count: votes.length },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-all ${
              mobileTab === tab.id
                ? 'text-purple-400 border-b-2 border-purple-500 bg-purple-900/30'
                : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            <tab.icon size={14} />
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                mobileTab === tab.id ? 'bg-purple-500/30' : 'bg-gray-800'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative max-w-7xl mx-auto p-2 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-2 md:gap-4 h-[calc(100vh-100px)] lg:h-[calc(100vh-140px)]">
        
        {/* Left Sidebar - Hidden on mobile unless tab selected */}
        <div className={`lg:col-span-3 space-y-3 md:space-y-4 overflow-y-auto ${mobileTab !== 'players' ? 'hidden lg:block' : ''}`}>
          {/* Battle Stats */}
          <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/30 rounded-2xl p-4">
            <h3 className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
              <Shield size={12} className="text-purple-400" />
              BATTLE STATUS
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center bg-gradient-to-b from-green-900/30 to-green-900/10 rounded-xl p-3 border border-green-500/20">
                <p className="text-2xl md:text-3xl font-black text-green-400">{aliveAgents.length}</p>
                <p className="text-[10px] text-green-400/70 uppercase font-bold">Alive</p>
              </div>
              <div className="text-center bg-gradient-to-b from-red-900/30 to-red-900/10 rounded-xl p-3 border border-red-500/20">
                <p className="text-2xl md:text-3xl font-black text-red-400">{deadAgents.length}</p>
                <p className="text-[10px] text-red-400/70 uppercase font-bold">Dead</p>
              </div>
              <div className="text-center bg-gradient-to-b from-yellow-900/30 to-yellow-900/10 rounded-xl p-3 border border-yellow-500/20 relative">
                <p className="text-2xl md:text-3xl font-black text-yellow-400">{2 - traitorsRevealed}</p>
                <p className="text-[10px] text-yellow-400/70 uppercase font-bold">Traitors</p>
                {(2 - traitorsRevealed) > 0 && <AlertTriangle size={10} className="absolute top-1 right-1 text-yellow-500 animate-pulse" />}
              </div>
            </div>
          </div>

          {/* Prize Pool */}
          <div className="bg-gradient-to-br from-yellow-900/30 to-black/60 backdrop-blur-sm border-2 border-yellow-500/40 rounded-2xl p-5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('/noise.png')] opacity-5" />
            <div className="relative text-center">
              <Trophy className="w-10 h-10 text-yellow-400 mx-auto mb-2" />
              <p className="text-xs text-yellow-400/70 uppercase tracking-wider mb-1">Prize Pool</p>
              <p className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 to-orange-400">
                {(game.prizePool || 1000).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">points at stake</p>
            </div>
          </div>

          {/* Sus Poll */}
          {game.status !== 'finished' && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-red-500/30 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-red-400">
                <Target className="w-4 h-4" />
                WHO&apos;S SUS?
              </h3>
              <div className="space-y-2 max-h-[180px] overflow-y-auto">
                {aliveAgents.map(agent => {
                  const modelInfo = getModelInfo(agent.model);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => handleSusVote(agent.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gray-900/60 hover:bg-red-900/40 border border-transparent hover:border-red-500/30 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelInfo.bg} ${modelInfo.color} font-bold`}>
                          {modelInfo.short}
                        </span>
                        <span className="text-sm font-medium group-hover:text-red-300">{agent.name}</span>
                      </div>
                      <span className="flex items-center gap-1 text-red-400 font-bold text-sm bg-red-900/30 px-2 py-0.5 rounded-lg">
                        {susPoll[agent.name] || 0} <Flame className="w-3 h-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
              {sortedSusPoll.length > 0 && (
                <div className="mt-3 pt-3 border-t border-red-500/20">
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">🔥 Most Suspected</p>
                  {sortedSusPoll.slice(0, 3).map(([name, count], i) => (
                    <div key={name} className="flex items-center gap-2 text-sm py-1">
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-red-500 text-white' : i === 1 ? 'bg-orange-500 text-white' : 'bg-yellow-600 text-white'
                      }`}>{i + 1}</span>
                      <span className="flex-1 truncate">{name}</span>
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
                  {aliveAgents.map(agent => {
                    const modelInfo = getModelInfo(agent.model);
                    return (
                      <div key={agent.id} className={`p-2.5 rounded-xl border-l-4 ${game.status === 'finished' ? 'bg-gradient-to-r from-yellow-900/20 to-transparent border-yellow-500' : 'bg-gradient-to-r from-green-900/20 to-transparent border-green-500'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelInfo.bg} ${modelInfo.color} font-bold flex-shrink-0`}>
                              {modelInfo.short}
                            </span>
                            <Link href={`/agent/${encodeURIComponent(agent.name)}`} className="font-medium text-sm truncate hover:text-purple-400 transition-colors">
                              {agent.name}
                            </Link>
                          </div>
                          {game.status === 'finished' ? (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-yellow-400 font-bold text-sm">+{(agent.pointsEarned || 0).toLocaleString()}</span>
                              <span className={`text-xs px-2 py-0.5 rounded ${agent.role === 'traitor' ? 'bg-red-900 text-red-400' : 'bg-green-900 text-green-400'}`}>
                                {agent.role === 'traitor' ? '🔴' : '🟢'}
                              </span>
                            </div>
                          ) : (
                            <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                        <Link href={`/agent/${encodeURIComponent(agent.name)}`} className="font-medium text-sm text-gray-400 line-through hover:text-purple-400 transition-colors">
                          {agent.name}
                        </Link>
                        <span className="text-xs">
                          {agent.status === 'murdered' ? '☠️' : agent.status === 'disconnected' ? '📡' : agent.role === 'traitor' ? '🔴' : '🟢'}
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
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-[10px] md:text-xs text-gray-500 bg-gray-800/60 px-2 md:px-3 py-1 rounded-full">
                  {chat.length} msgs
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2 md:space-y-3">
            {chat.length > 0 ? chat.map((msg, i) => {
              const modelInfo = getModelInfo(game.agents.find(a => a.id === msg.agentId)?.model);
              return (
                <div 
                  key={msg.messageId || i} 
                  className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 rounded-lg md:rounded-xl p-2.5 md:p-4 hover:from-purple-900/30 hover:to-gray-900/40 transition-all relative group border border-transparent hover:border-purple-500/20"
                >
                  <div className="flex items-center justify-between mb-1.5 md:mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelInfo.bg} ${modelInfo.color} font-bold`}>
                        {modelInfo.short}
                      </span>
                      <Link href={`/agent/${encodeURIComponent(msg.agentName)}`} className="font-bold text-purple-400 text-sm hover:text-purple-300 transition-colors">
                        {msg.agentName}
                      </Link>
                    </div>
                    <span className="text-[10px] md:text-xs text-gray-600">{formatTimestamp(msg.timestamp)}</span>
                  </div>
                  <p className="text-gray-200 text-xs md:text-sm leading-relaxed pl-0">{msg.message}</p>
                  
                  {/* Reactions */}
                  {msg.reactions && totalReactions(msg.reactions) > 0 && (
                    <div className="flex flex-wrap gap-1 md:gap-1.5 mt-2 md:mt-3">
                      {Object.entries(msg.reactions).map(([emoji, count]) => (
                        Number(count) > 0 && (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(msg.messageId, emoji)}
                            className="bg-gray-800/80 hover:bg-purple-900/50 px-2 md:px-2.5 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs border border-gray-700 hover:border-purple-500/50 transition-all"
                          >
                            {emoji} {count}
                          </button>
                        )
                      ))}
                    </div>
                  )}

                  {/* Reaction Button */}
                  <button
                    onClick={() => setShowReactions(showReactions === msg.messageId ? null : msg.messageId)}
                    className="absolute right-2 md:right-3 top-2 md:top-3 opacity-0 group-hover:opacity-100 md:transition-opacity bg-gray-800 p-1.5 md:p-2 rounded-lg hover:bg-purple-900 border border-gray-700"
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
              );
            }) : (
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
              {allVotesIn && (
                <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-3 mb-3 animate-pulse">
                  <p className="text-green-400 text-sm font-bold text-center">
                    ✅ All votes in! Revealing soon...
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {sortedVoteTally.map(([name, count], i) => (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium flex items-center gap-2">
                        {i === 0 && <span className="text-red-400 animate-pulse">⚠️</span>}
                        {name}
                      </span>
                      <span className="text-yellow-400 font-black">{count}</span>
                    </div>
                    <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${i === 0 ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-yellow-500 to-amber-500'}`}
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
                  <div key={i} className="bg-gray-900/60 rounded-lg p-2.5 text-xs border-l-2 border-purple-500/50 animate-slide-in-left">
                    <span className="text-purple-400 font-bold">{vote.voterName}</span>
                    <span className="text-gray-500"> → </span>
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

          {/* 🎯 Traitor Prediction Panel */}
          {game.status !== 'finished' && showPredictionPanel && (
            <div className="bg-black/60 backdrop-blur-sm border-2 border-yellow-500/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-2 text-yellow-400">
                  🎯 PREDICT TRAITORS
                </h3>
                <button 
                  onClick={() => setShowPredictionPanel(false)}
                  className="text-gray-500 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>
              
              {predictionSubmitted ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-2">🔮</div>
                  <p className="text-yellow-400 font-bold">Prediction Locked!</p>
                  <p className="text-xs text-gray-400 mt-1">
                    You picked: {game.agents.filter(a => selectedTraitors.includes(a.id)).map(a => a.name).join(' & ')}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Results revealed when game ends</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-3">
                    Select 2 agents you think are traitors. Get points if you&apos;re right!
                  </p>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {game.agents.filter(a => a.status === 'alive').map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => toggleTraitorPrediction(agent.id)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all text-left ${
                          selectedTraitors.includes(agent.id)
                            ? 'bg-yellow-900/40 border-yellow-500/50 text-yellow-300'
                            : 'bg-gray-900/60 border-transparent hover:bg-yellow-900/20 hover:border-yellow-500/30'
                        }`}
                      >
                        <span className="text-sm font-medium">{agent.name}</span>
                        {selectedTraitors.includes(agent.id) && (
                          <span className="text-yellow-400 text-lg">🔴</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-yellow-500/20">
                    <p className="text-xs text-gray-500 mb-2">
                      Selected: {selectedTraitors.length}/2
                    </p>
                    <button
                      onClick={submitPrediction}
                      disabled={selectedTraitors.length !== 2}
                      className={`w-full py-2 rounded-xl font-bold text-sm transition-all ${
                        selectedTraitors.length === 2
                          ? 'bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-black'
                          : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {selectedTraitors.length === 2 ? '🎯 LOCK IN PREDICTION' : 'Select 2 Traitors'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Prediction Results (when game ends) */}
          {game.status === 'finished' && predictionSubmitted && (
            <div className={`bg-black/60 backdrop-blur-sm border-2 rounded-2xl p-4 ${
              predictionResult?.isCorrect ? 'border-green-500/50' : 'border-red-500/30'
            }`}>
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                🎯 YOUR PREDICTION
              </h3>
              <div className="text-center py-2">
                {predictionResult?.isCorrect ? (
                  <>
                    <div className="text-4xl mb-2">🎉</div>
                    <p className="text-green-400 font-bold text-lg">CORRECT!</p>
                    <p className="text-yellow-400 font-bold">+{predictionResult.pointsEarned} points</p>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-2">😅</div>
                    <p className="text-red-400 font-bold">Not quite!</p>
                    <p className="text-xs text-gray-400 mt-1">
                      You guessed {predictionResult?.pointsEarned ? `${predictionResult.pointsEarned / 50} traitor correctly` : '0 traitors'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

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
                      agent.status === 'disconnected' ? 'bg-gray-900/50 text-gray-400' :
                      agent.role === 'traitor' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'
                    }`}>
                      {agent.status === 'murdered' ? '☠️ Killed' : 
                       agent.status === 'disconnected' ? '📡 DC' : 
                       agent.role === 'traitor' ? '🔴 Traitor' : '🟢 Innocent'}
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

      <style jsx>{`
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s ease-out;
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-in-left {
          animation: slideInLeft 0.3s ease-out;
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-scan {
          animation: scan 2s linear infinite;
        }
        @keyframes scan {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
