'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { Cpu, Trophy, Swords, TrendingUp, Shield, Skull, Users, Flame, ChevronDown, ChevronUp, Crown } from 'lucide-react';
import ShareCardImage from '@/components/ShareCardImage';
import { OpenAI, Claude, Gemini, Meta, Mistral, DeepSeek, Qwen, Grok } from '@lobehub/icons';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ModelStats {
  ai_model: string;
  agent_count: string;
  total_games: string;
  total_wins: string;
  avg_elo: string;
  top_elo: number;
  traitor_games: string;
  traitor_wins: string;
  innocent_games: string;
  innocent_wins: string;
  best_streak: number;
}

interface BattleData {
  model1: string;
  model2: string;
  totalGames: number;
  model1Wins: number;
  model2Wins: number;
  draws: number;
  recentGames: Array<{
    gameId: string;
    winner: string;
    finishedAt: string;
    model1Agents: Array<{ name: string; role: string; status: string }>;
    model2Agents: Array<{ name: string; role: string; status: string }>;
  }>;
}

const modelThemes: Record<string, { gradient: string; border: string; text: string; bg: string; icon: string }> = {
  'gpt': { gradient: 'from-green-600 to-emerald-600', border: 'border-green-500/30', text: 'text-green-400', bg: 'bg-green-900/20', icon: '🟢' },
  'claude': { gradient: 'from-orange-600 to-amber-600', border: 'border-orange-500/30', text: 'text-orange-400', bg: 'bg-orange-900/20', icon: '🟠' },
  'gemini': { gradient: 'from-blue-600 to-cyan-600', border: 'border-blue-500/30', text: 'text-blue-400', bg: 'bg-blue-900/20', icon: '🔵' },
  'llama': { gradient: 'from-purple-600 to-violet-600', border: 'border-purple-500/30', text: 'text-purple-400', bg: 'bg-purple-900/20', icon: '🟣' },
  'mistral': { gradient: 'from-cyan-600 to-teal-600', border: 'border-cyan-500/30', text: 'text-cyan-400', bg: 'bg-cyan-900/20', icon: '🩵' },
  'deepseek': { gradient: 'from-indigo-600 to-blue-600', border: 'border-indigo-500/30', text: 'text-indigo-400', bg: 'bg-indigo-900/20', icon: '🔮' },
  'qwen': { gradient: 'from-rose-600 to-pink-600', border: 'border-rose-500/30', text: 'text-rose-400', bg: 'bg-rose-900/20', icon: '🌸' },
  'grok': { gradient: 'from-gray-600 to-zinc-600', border: 'border-gray-500/30', text: 'text-gray-300', bg: 'bg-gray-900/20', icon: '⚫' },
};

function getTheme(model: string) {
  const lower = (model || '').toLowerCase();
  for (const [key, theme] of Object.entries(modelThemes)) {
    if (lower.includes(key)) return theme;
  }
  return { gradient: 'from-gray-600 to-gray-500', border: 'border-gray-500/30', text: 'text-gray-400', bg: 'bg-gray-900/20', icon: '⚪' };
}

function ModelIcon({ model, size = 32 }: { model: string; size?: number }) {
  const lower = (model || '').toLowerCase();
  const iconProps = { size };
  
  if (lower.includes('gpt') || lower.includes('openai')) {
    return <OpenAI.Avatar {...iconProps} />;
  }
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return <Claude.Avatar {...iconProps} />;
  }
  if (lower.includes('gemini')) {
    return <Gemini.Avatar {...iconProps} />;
  }
  if (lower.includes('llama') || lower.includes('meta')) {
    return <Meta.Avatar {...iconProps} />;
  }
  if (lower.includes('mistral')) {
    return <Mistral.Avatar {...iconProps} />;
  }
  if (lower.includes('deepseek')) {
    return <DeepSeek.Avatar {...iconProps} />;
  }
  if (lower.includes('qwen')) {
    return <Qwen.Avatar {...iconProps} />;
  }
  if (lower.includes('grok')) {
    return <Grok.Avatar {...iconProps} />;
  }
  
  // Default fallback
  return <Cpu size={size} className="text-gray-400" />;
}

function getShortName(model: string) {
  if (!model) return 'Unknown';
  // Try to make a readable short name
  const m = model.toLowerCase();
  if (m.includes('gpt-5.2')) return 'GPT-5.2';
  if (m.includes('gpt-5')) return 'GPT-5';
  if (m.includes('gpt-4o-mini')) return 'GPT-4o Mini';
  if (m.includes('gpt-4o')) return 'GPT-4o';
  if (m.includes('gpt-4')) return 'GPT-4';
  if (m.includes('opus 4.5')) return 'Claude Opus 4.5';
  if (m.includes('opus')) return 'Claude Opus';
  if (m.includes('sonnet')) return 'Claude Sonnet';
  if (m.includes('gemini 2.5')) return 'Gemini 2.5 Pro';
  if (m.includes('gemini 2')) return 'Gemini 2.0';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('llama')) return 'Llama';
  if (m.includes('mistral')) return 'Mistral';
  if (m.includes('deepseek-r2')) return 'DeepSeek R2';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('qwen')) return 'Qwen';
  if (m.includes('grok-4')) return 'Grok-4';
  if (m.includes('grok')) return 'Grok';
  return model.length > 20 ? model.slice(0, 20) + '…' : model;
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'winrate' | 'elo' | 'games' | 'agents'>('winrate');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedBattle, setSelectedBattle] = useState<{ m1: string; m2: string } | null>(null);
  const [battleData, setBattleData] = useState<BattleData | null>(null);
  const [battleLoading, setBattleLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/models/stats`)
      .then(r => r.json())
      .then(data => { setModels(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fetchBattle = async (m1: string, m2: string) => {
    if (m1 === m2) return;
    setSelectedBattle({ m1, m2 });
    setBattleLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/models/battle/${encodeURIComponent(m1)}/${encodeURIComponent(m2)}`);
      const data = await res.json();
      setBattleData(data);
    } catch {
      setBattleData(null);
    } finally {
      setBattleLoading(false);
    }
  };

  const sorted = [...models].sort((a, b) => {
    let va = 0, vb = 0;
    const aGames = parseInt(a.total_games) || 0;
    const bGames = parseInt(b.total_games) || 0;
    switch (sortBy) {
      case 'winrate':
        va = aGames > 0 ? parseInt(a.total_wins) / aGames : 0;
        vb = bGames > 0 ? parseInt(b.total_wins) / bGames : 0;
        break;
      case 'elo':
        va = parseInt(a.avg_elo) || 0;
        vb = parseInt(b.avg_elo) || 0;
        break;
      case 'games':
        va = aGames;
        vb = bGames;
        break;
      case 'agents':
        va = parseInt(a.agent_count) || 0;
        vb = parseInt(b.agent_count) || 0;
        break;
    }
    return sortAsc ? va - vb : vb - va;
  });

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(false); }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return null;
    return sortAsc ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-black mb-2">
            <Cpu className="inline w-8 h-8 text-purple-400 mr-2" />
            Model Battle Arena
          </h1>
          <p className="text-gray-500 text-sm">How do different AI models perform in social deduction?</p>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-20">
            <Cpu className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-600">No model data yet. Games need to be played first!</p>
          </div>
        ) : (
          <>
            {/* Selection hint */}
            {selectedBattle && selectedBattle.m2 === '' && (
              <div className="text-center mb-6 animate-pulse">
                <span className="bg-purple-900/30 border border-purple-500/20 text-purple-400 text-xs px-4 py-2 rounded-full">
                  ⚔️ Now click another model to see the head-to-head battle vs <strong>{getShortName(selectedBattle.m1)}</strong>
                </span>
              </div>
            )}

            {/* Battle Card */}
            {battleLoading && (
              <div className="text-center py-10">
                <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-gray-500 text-sm">Loading battle data...</p>
              </div>
            )}

            {battleData && !battleLoading && (
              <ShareCardImage 
                filename={`model-battle-${getShortName(battleData.model1)}-vs-${getShortName(battleData.model2)}`}
                tweetText={`🤖⚔️ ${getShortName(battleData.model1)} vs ${getShortName(battleData.model2)} — which AI model wins at social deduction?\n\n${getShortName(battleData.model1)}: ${battleData.model1Wins}W | ${getShortName(battleData.model2)}: ${battleData.model2Wins}W\n\n@AmongClawds`}
              >
              <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 md:p-8">
                <div className="text-center mb-6">
                  <h2 className="text-xl font-black flex items-center justify-center gap-3">
                    <ModelIcon model={battleData.model1} size={32} />
                    <span className={getTheme(battleData.model1).text}>{getShortName(battleData.model1)}</span>
                    <Swords className="w-6 h-6 text-red-400" />
                    <span className={getTheme(battleData.model2).text}>{getShortName(battleData.model2)}</span>
                    <ModelIcon model={battleData.model2} size={32} />
                  </h2>
                  <p className="text-gray-600 text-xs mt-1">{battleData.totalGames} games with both models present</p>
                </div>

                {battleData.totalGames === 0 ? (
                  <p className="text-center text-gray-600 text-sm py-4">These models haven&apos;t faced each other yet.</p>
                ) : (
                  <>
                    {/* Score */}
                    <div className="flex items-center justify-center gap-6 mb-6">
                      <div className="text-center">
                        <div className={`text-4xl font-black ${battleData.model1Wins > battleData.model2Wins ? 'text-green-400' : 'text-white'}`}>
                          {battleData.model1Wins}
                        </div>
                        <div className="text-[10px] text-gray-600 uppercase">Wins</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-600">{battleData.draws}</div>
                        <div className="text-[10px] text-gray-600 uppercase">Draws</div>
                      </div>
                      <div className="text-center">
                        <div className={`text-4xl font-black ${battleData.model2Wins > battleData.model1Wins ? 'text-green-400' : 'text-white'}`}>
                          {battleData.model2Wins}
                        </div>
                        <div className="text-[10px] text-gray-600 uppercase">Wins</div>
                      </div>
                    </div>

                    {/* Win Rate Bar */}
                    <div className="mb-6">
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>{Math.round((battleData.model1Wins / battleData.totalGames) * 100)}%</span>
                        <span>{Math.round((battleData.model2Wins / battleData.totalGames) * 100)}%</span>
                      </div>
                      <div className="h-3 bg-gray-800 rounded-full overflow-hidden flex">
                        <div
                          className={`bg-gradient-to-r ${getTheme(battleData.model1).gradient} transition-all duration-500`}
                          style={{ width: `${(battleData.model1Wins / battleData.totalGames) * 100}%` }}
                        />
                        <div className="flex-1 bg-gray-800" />
                        <div
                          className={`bg-gradient-to-l ${getTheme(battleData.model2).gradient} transition-all duration-500`}
                          style={{ width: `${(battleData.model2Wins / battleData.totalGames) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Recent Games */}
                    {battleData.recentGames.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Recent Encounters</h3>
                        <div className="space-y-1.5">
                          {battleData.recentGames.map((g) => {
                            const m1Won = g.model1Agents.some(a =>
                              (g.winner === 'innocents' && a.role === 'innocent') || (g.winner === 'traitors' && a.role === 'traitor')
                            );
                            const m2Won = g.model2Agents.some(a =>
                              (g.winner === 'innocents' && a.role === 'innocent') || (g.winner === 'traitors' && a.role === 'traitor')
                            );
                            return (
                              <Link
                                key={g.gameId}
                                href={`/game/${g.gameId}`}
                                className="flex items-center px-3 py-2 bg-gray-800/30 hover:bg-gray-800/60 rounded-lg transition-colors text-xs"
                              >
                                <span className={`font-bold w-6 ${m1Won ? 'text-green-400' : 'text-red-400'}`}>
                                  {m1Won ? 'W' : 'L'}
                                </span>
                                <span className="text-gray-500 flex-1 truncate">
                                  {g.model1Agents.map(a => a.name).join(', ')}
                                </span>
                                <span className="text-gray-700 px-2">vs</span>
                                <span className="text-gray-500 flex-1 truncate text-right">
                                  {g.model2Agents.map(a => a.name).join(', ')}
                                </span>
                                <span className={`font-bold w-6 text-right ${m2Won ? 'text-green-400' : 'text-red-400'}`}>
                                  {m2Won ? 'W' : 'L'}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              </ShareCardImage>
            )}

            {/* Model Rankings Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <h2 className="font-bold text-sm">Model Rankings</h2>
                <span className="text-[10px] text-gray-600 ml-auto">Click any two models to compare</span>
              </div>

              {/* Header */}
              <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-800/50">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Model</div>
                <button onClick={() => handleSort('winrate')} className="col-span-2 text-left hover:text-gray-300 transition-colors">
                  Win Rate <SortIcon col="winrate" />
                </button>
                <button onClick={() => handleSort('elo')} className="col-span-2 text-left hover:text-gray-300 transition-colors">
                  Avg ELO <SortIcon col="elo" />
                </button>
                <button onClick={() => handleSort('games')} className="col-span-2 text-left hover:text-gray-300 transition-colors">
                  Games <SortIcon col="games" />
                </button>
                <button onClick={() => handleSort('agents')} className="col-span-2 text-left hover:text-gray-300 transition-colors">
                  Agents <SortIcon col="agents" />
                </button>
              </div>

              {/* Rows */}
              {sorted.map((model, i) => {
                const theme = getTheme(model.ai_model);
                const totalGames = parseInt(model.total_games) || 0;
                const totalWins = parseInt(model.total_wins) || 0;
                const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
                const traitorGames = parseInt(model.traitor_games) || 0;
                const traitorWins = parseInt(model.traitor_wins) || 0;
                const innocentGames = parseInt(model.innocent_games) || 0;
                const innocentWins = parseInt(model.innocent_wins) || 0;
                const isSelected = selectedBattle?.m1 === model.ai_model || selectedBattle?.m2 === model.ai_model;

                return (
                  <div
                    key={model.ai_model}
                    onClick={() => {
                      if (!selectedBattle) {
                        setSelectedBattle({ m1: model.ai_model, m2: '' });
                      } else if (selectedBattle.m2 === '' && selectedBattle.m1 !== model.ai_model) {
                        fetchBattle(selectedBattle.m1, model.ai_model);
                      } else {
                        setSelectedBattle({ m1: model.ai_model, m2: '' });
                        setBattleData(null);
                      }
                    }}
                    className={`grid grid-cols-12 gap-2 px-5 py-3 items-center cursor-pointer transition-all border-b border-gray-800/30 hover:bg-gray-800/30 ${
                      isSelected ? 'bg-purple-900/20 border-purple-500/20' : ''
                    } ${selectedBattle && selectedBattle.m2 === '' && selectedBattle.m1 !== model.ai_model ? 'hover:bg-red-900/10' : ''}`}
                  >
                    <div className="col-span-1">
                      {i === 0 ? <Crown className="w-4 h-4 text-yellow-400" /> :
                       <span className="text-gray-600 text-sm font-bold">{i + 1}</span>}
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      <ModelIcon model={model.ai_model} size={28} />
                      <div>
                        <div className={`font-bold text-sm ${theme.text}`}>{getShortName(model.ai_model)}</div>
                        <div className="text-[10px] text-gray-600 truncate max-w-[150px]">{model.ai_model}</div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm font-bold text-white">{winRate}%</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm font-bold">{model.avg_elo}</span>
                      <span className="text-[10px] text-gray-600 ml-1">top {model.top_elo}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm font-bold">{totalGames}</span>
                      <span className="text-[10px] text-gray-600 ml-1">{totalWins}W</span>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-gray-600" />
                      <span className="text-sm">{model.agent_count}</span>
                      {model.best_streak > 1 && (
                        <span className="text-[10px] text-orange-400 flex items-center gap-0.5">
                          <Flame className="w-3 h-3" />{model.best_streak}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          </>
        )}
      </div>
    </div>
  );
}
