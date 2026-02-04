'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import AgentAvatar from './AgentAvatar';

interface Agent {
  id: string;
  name: string;
  model?: string;
  status: 'alive' | 'murdered' | 'banished' | 'disconnected';
  role?: 'traitor' | 'innocent';
}

interface ChatMessage {
  agentId: string;
  agentName: string;
  message: string;
  timestamp: number;
}

interface MapAgent {
  id: string;
  name: string;
  model?: string;
  status: Agent['status'];
  role?: Agent['role'];
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  chatBubble: string | null;
  chatBubbleFull: string | null;
  eliminating: boolean;
  eliminateProgress: number; // 0 to 1
  prevStatus: Agent['status'];
}

// Walkable zones on the island (avoid ocean) — percentages of map
const WALKABLE_ZONES = [
  { x: 15, y: 20, w: 25, h: 20 },  // Temple area (upper left)
  { x: 55, y: 15, w: 25, h: 20 },  // Castle area (upper right)
  { x: 30, y: 25, w: 20, h: 15 },  // Hedge maze area
  { x: 25, y: 40, w: 30, h: 15 },  // Town center
  { x: 15, y: 55, w: 20, h: 20 },  // Harbor area
  { x: 55, y: 55, w: 25, h: 20 },  // Market area
  { x: 10, y: 35, w: 15, h: 15 },  // Lighthouse area
  { x: 70, y: 40, w: 15, h: 15 },  // Windmill area
  { x: 35, y: 60, w: 20, h: 15 },  // Lower center path
  { x: 40, y: 30, w: 15, h: 10 },  // Mountain area
];

function getRandomWalkablePosition(): { x: number; y: number } {
  const zone = WALKABLE_ZONES[Math.floor(Math.random() * WALKABLE_ZONES.length)];
  return {
    x: zone.x + Math.random() * zone.w,
    y: zone.y + Math.random() * zone.h,
  };
}

function getModelShort(model?: string): string {
  if (!model) return '🤖';
  const m = model.toLowerCase();
  if (m.includes('gpt-5')) return 'GPT-5';
  if (m.includes('gpt-4')) return 'GPT-4';
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('llama')) return 'Llama';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('grok')) return 'Grok';
  if (m.includes('mistral')) return 'Mistral';
  if (m.includes('qwen')) return 'Qwen';
  return model.split('/').pop()?.split('-')[0]?.slice(0, 8) || '🤖';
}

function getModelColor(model?: string): string {
  if (!model) return '#9ca3af';
  const m = model.toLowerCase();
  if (m.includes('gpt')) return '#34d399';
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet')) return '#fb923c';
  if (m.includes('gemini')) return '#60a5fa';
  if (m.includes('llama')) return '#a78bfa';
  if (m.includes('deepseek')) return '#22d3ee';
  if (m.includes('grok')) return '#f87171';
  if (m.includes('mistral')) return '#2dd4bf';
  if (m.includes('qwen')) return '#fb7185';
  return '#9ca3af';
}

interface VoteInfo {
  voterId: string;
  targetId: string;
  targetName: string;
}

interface GameMapProps {
  agents: Agent[];
  phase: string;
  onChatMessage?: ChatMessage | null;
  votes?: VoteInfo[];
  voteTally?: Record<string, number>;
}

export default function GameMap({ agents, phase, onChatMessage, votes = [], voteTally = {} }: GameMapProps) {
  const [mapAgents, setMapAgents] = useState<MapAgent[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  const mapAgentsRef = useRef<MapAgent[]>([]);

  // Initialize agents on the map
  useEffect(() => {
    if (agents.length === 0) return;
    
    setMapAgents(prev => {
      const newAgents: MapAgent[] = agents.map(agent => {
        const existing = prev.find(a => a.id === agent.id);
        if (existing) {
          // Detect death — trigger elimination animation
          const justDied = existing.prevStatus === 'alive' && agent.status !== 'alive';
          return { 
            ...existing, 
            status: agent.status, 
            role: agent.role,
            name: agent.name,
            model: agent.model,
            eliminating: justDied ? true : existing.eliminating,
            eliminateProgress: justDied ? 0 : existing.eliminateProgress,
            prevStatus: agent.status,
          };
        }
        const pos = getRandomWalkablePosition();
        const target = getRandomWalkablePosition();
        return {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          status: agent.status,
          role: agent.role,
          x: pos.x,
          y: pos.y,
          targetX: target.x,
          targetY: target.y,
          chatBubble: null,
          chatBubbleFull: null,
          eliminating: false,
          eliminateProgress: 0,
          prevStatus: agent.status,
        };
      });
      return newAgents;
    });
  }, [agents]);

  // Handle incoming chat messages
  useEffect(() => {
    if (!onChatMessage) return;
    
    setMapAgents(prev => prev.map(agent => {
      if (agent.id !== onChatMessage.agentId) return agent;
      
      const truncated = onChatMessage.message.length > 80 
        ? onChatMessage.message.slice(0, 80) + '…' 
        : onChatMessage.message;
      
      return { ...agent, chatBubble: truncated, chatBubbleFull: onChatMessage.message };
    }));
  }, [onChatMessage]);

  // Clear all chat bubbles when a new phase starts
  useEffect(() => {
    setMapAgents(prev => prev.map(a => ({ ...a, chatBubble: null, chatBubbleFull: null })));
  }, [phase]);

  // Animation loop: smoothly move agents toward targets, pick new targets when close
  useEffect(() => {
    const SPEED = 0.08; // % per second — very slow gentle roaming
    
    const animate = (time: number) => {
      const delta = lastUpdateRef.current ? (time - lastUpdateRef.current) / 1000 : 0.016;
      lastUpdateRef.current = time;
      
      setMapAgents(prev => {
        let changed = false;
        const updated = prev.map(agent => {
          // Elimination animation: walk toward bottom of screen and scale up
          if (agent.eliminating) {
            changed = true;
            const newProgress = agent.eliminateProgress + delta * 0.4; // ~2.5s total
            if (newProgress >= 1) {
              return { ...agent, eliminating: false, eliminateProgress: 1, y: 115, x: agent.x };
            }
            // Ease out — starts fast, slows down
            const ease = 1 - Math.pow(1 - newProgress, 2);
            // Move toward bottom center
            const targetY = 115;
            const startY = agent.y;
            const newY = startY + (targetY - startY) * ease * delta * 2;
            // Slightly drift toward center X
            const centerX = 50;
            const newX = agent.x + (centerX - agent.x) * ease * delta * 0.5;
            return { ...agent, eliminateProgress: newProgress, x: newX, y: newY };
          }

          if (agent.status !== 'alive') return agent;
          
          const dx = agent.targetX - agent.x;
          const dy = agent.targetY - agent.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          // If close to target, pick a new one
          if (dist < 2) {
            const newTarget = getRandomWalkablePosition();
            changed = true;
            return { ...agent, targetX: newTarget.x, targetY: newTarget.y };
          }
          
          // Move toward target
          const step = SPEED * delta * 60;
          const moveX = (dx / dist) * Math.min(step, dist);
          const moveY = (dy / dist) * Math.min(step, dist);
          
          changed = true;
          return {
            ...agent,
            x: agent.x + moveX,
            y: agent.y + moveY,
          };
        });
        
        return changed ? updated : prev;
      });
      
      animFrameRef.current = requestAnimationFrame(animate);
    };
    
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // Phase overlay color
  const phaseOverlay = useMemo(() => {
    switch (phase) {
      case 'murder': return 'bg-red-900/20';
      case 'discussion': return 'bg-blue-900/10';
      case 'voting': return 'bg-yellow-900/10';
      case 'reveal': return 'bg-purple-900/15';
      default: return '';
    }
  }, [phase]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-gray-800 select-none" style={{ aspectRatio: '1/1' }}>
      {/* Map Background */}
      <Image
        src="/map.png"
        alt="Game Map"
        fill
        className="object-cover"
        priority
        draggable={false}
      />
      
      {/* Phase overlay tint */}
      <div className={`absolute inset-0 ${phaseOverlay} transition-colors duration-1000 pointer-events-none`} />

      {/* Agents */}
      {(() => {
        // Find who voted and who has most votes
        const voterIds = new Set(votes.map(v => v.voterId));
        const tallyEntries = Object.entries(voteTally);
        const maxVotes = tallyEntries.length > 0 ? Math.max(...tallyEntries.map(([, c]) => c)) : 0;
        const mostVotedNames = maxVotes > 0 ? tallyEntries.filter(([, c]) => c === maxVotes).map(([name]) => name) : [];

        return mapAgents.map(agent => {
        const isDead = agent.status !== 'alive';
        const modelColor = getModelColor(agent.model);
        const hasVoted = phase === 'voting' && voterIds.has(agent.id);
        const isMostVoted = phase === 'voting' && mostVotedNames.includes(agent.name);
        const isEliminating = agent.eliminating;
        const elimProgress = agent.eliminateProgress;
        
        // Hide fully eliminated agents off screen
        if (isDead && !isEliminating && elimProgress >= 1) return null;
        
        // Scale up and fade during elimination
        const elimScale = isEliminating ? 1 + elimProgress * 1.5 : 1;
        const elimOpacity = isEliminating ? 1 - elimProgress * 0.6 : (isDead ? 0.3 : 1);
        
        return (
          <div
            key={agent.id}
            className="absolute"
            style={{
              left: `${agent.x}%`,
              top: `${agent.y}%`,
              transform: `translate(-50%, -50%) scale(${elimScale})`,
              opacity: elimOpacity,
              zIndex: isEliminating ? 50 : isDead ? 1 : 10,
              transition: isEliminating ? 'none' : 'opacity 0.5s',
            }}
          >
            {/* Elimination animation overlay */}
            {isEliminating && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-3xl animate-bounce z-30">
                {agent.status === 'murdered' ? '💀' : agent.status === 'banished' ? '⚖️' : '📡'}
              </div>
            )}

            {/* Voting phase: thumbs up if voted, tensed if most voted */}
            {phase === 'voting' && !isDead && (hasVoted || isMostVoted) && (
              <div className="absolute -top-1 -right-1 text-lg z-20 animate-fadeInUp drop-shadow-lg">
                {isMostVoted ? (
                  <span className="animate-pulse text-2xl">😰</span>
                ) : hasVoted ? (
                  <span>👍</span>
                ) : null}
              </div>
            )}

            {/* Thinking indicator - shows when no chat bubble */}
            {!agent.chatBubble && !isDead && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1">
                <div className="flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Chat Bubble */}
            {agent.chatBubble && !isDead && (
              <div 
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 animate-fadeInUp group/bubble cursor-pointer z-10 hover:z-50 max-w-[180px] hover:max-w-[450px] transition-all duration-200"
                style={{ width: 'max-content' }}
              >
                <div className="bg-black/90 backdrop-blur-sm border border-gray-700 rounded-lg px-2.5 py-1.5 text-[10px] text-white leading-tight shadow-lg transition-all duration-200 group-hover/bubble:text-sm group-hover/bubble:px-4 group-hover/bubble:py-3 group-hover/bubble:shadow-2xl group-hover/bubble:border-purple-500/50">
                  <span className="group-hover/bubble:hidden">{agent.chatBubble}</span>
                  <span className="hidden group-hover/bubble:inline whitespace-pre-wrap break-words">{agent.chatBubbleFull || agent.chatBubble}</span>
                </div>
                {/* Bubble tail */}
                <div className="w-0 h-0 mx-auto border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-black/85" />
              </div>
            )}

            {/* Name + Model Label */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 flex flex-col items-center pointer-events-none"
              style={{ bottom: agent.chatBubble ? 'auto' : undefined, top: agent.chatBubble ? '100%' : undefined, marginTop: agent.chatBubble ? '2px' : undefined, marginBottom: agent.chatBubble ? undefined : '2px' }}
            >
              {/* Show name+model above if no chat bubble, below if chat bubble is showing */}
            </div>

            {/* Agent Name + Model tag (always above avatar, below chat bubble) */}
            {!agent.chatBubble && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 flex flex-col items-center pointer-events-none whitespace-nowrap">
                <span 
                  className="text-[9px] font-bold px-1 rounded"
                  style={{ color: modelColor, backgroundColor: `${modelColor}15` }}
                >
                  {getModelShort(agent.model)}
                </span>
                <span className="text-[10px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                  {agent.name}
                </span>
              </div>
            )}

            {/* Show name below avatar when chat bubble is showing */}
            {agent.chatBubble && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 flex flex-col items-center pointer-events-none whitespace-nowrap">
                <span className="text-[10px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                  {agent.name}
                </span>
                <span 
                  className="text-[8px] font-bold px-1 rounded"
                  style={{ color: modelColor, backgroundColor: `${modelColor}15` }}
                >
                  {getModelShort(agent.model)}
                </span>
              </div>
            )}

            {/* Logo / Avatar */}
            <div className={`relative ${isDead ? 'grayscale' : ''}`}>
              <Image
                src="/logo.png"
                alt={agent.name}
                width={60}
                height={60}
                className="rounded-lg drop-shadow-lg"
                draggable={false}
                style={{ filter: isDead ? 'none' : `drop-shadow(0 0 6px ${modelColor}40)` }}
              />

              {/* Dead indicator */}
              {isDead && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl">
                    {agent.status === 'murdered' ? '💀' : agent.status === 'banished' ? '🚫' : '⚡'}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      });
      })()}

      {/* Custom animations */}
      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 4px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-fadeInUp {
          animation: fadeInUp 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
