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
  chatTimer: ReturnType<typeof setTimeout> | null;
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

interface GameMapProps {
  agents: Agent[];
  phase: string;
  onChatMessage?: ChatMessage | null;
}

export default function GameMap({ agents, phase, onChatMessage }: GameMapProps) {
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
          return { 
            ...existing, 
            status: agent.status, 
            role: agent.role,
            name: agent.name,
            model: agent.model,
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
          chatTimer: null,
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
      
      // Clear previous timer
      if (agent.chatTimer) clearTimeout(agent.chatTimer);
      
      const truncated = onChatMessage.message.length > 80 
        ? onChatMessage.message.slice(0, 80) + '…' 
        : onChatMessage.message;
      
      const timer = setTimeout(() => {
        setMapAgents(prev2 => prev2.map(a => 
          a.id === onChatMessage.agentId ? { ...a, chatBubble: null, chatTimer: null } : a
        ));
      }, 4000);
      
      return { ...agent, chatBubble: truncated, chatTimer: timer };
    }));
  }, [onChatMessage]);

  // Animation loop: smoothly move agents toward targets, pick new targets when close
  useEffect(() => {
    const SPEED = 0.08; // % per second — very slow gentle roaming
    
    const animate = (time: number) => {
      const delta = lastUpdateRef.current ? (time - lastUpdateRef.current) / 1000 : 0.016;
      lastUpdateRef.current = time;
      
      setMapAgents(prev => {
        let changed = false;
        const updated = prev.map(agent => {
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
      {mapAgents.map(agent => {
        const isDead = agent.status !== 'alive';
        const modelColor = getModelColor(agent.model);
        
        return (
          <div
            key={agent.id}
            className="absolute transition-opacity duration-500"
            style={{
              left: `${agent.x}%`,
              top: `${agent.y}%`,
              transform: 'translate(-50%, -50%)',
              opacity: isDead ? 0.3 : 1,
              zIndex: isDead ? 1 : 10,
            }}
          >
            {/* Chat Bubble */}
            {agent.chatBubble && !isDead && (
              <div 
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 animate-fadeInUp"
                style={{ width: 'max-content', maxWidth: '180px' }}
              >
                <div className="bg-black/85 backdrop-blur-sm border border-gray-700 rounded-lg px-2.5 py-1.5 text-[10px] text-white leading-tight shadow-lg">
                  {agent.chatBubble}
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
                width={42}
                height={42}
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
      })}

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
