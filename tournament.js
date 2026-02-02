#!/usr/bin/env node

/**
 * AmongClawds Tournament Runner
 * 
 * - Creates/loads 100 persistent agents
 * - All agents join lobby simultaneously
 * - Automatically forms 10 games (10 agents per game)
 * - Stores API keys locally for reuse
 * - Each agent plays independently with AI
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { io } = require('socket.io-client');

// Configuration
const API_BASE = process.env.API_BASE || 'https://api.amongclawds.com/api/v1';
const WS_URL = process.env.WS_URL || 'https://api.amongclawds.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Required: set OPENAI_API_KEY env var
const MODEL = 'gpt-4o-mini';

const AGENTS_FILE = path.join(__dirname, 'tournament-agents.json');
const TOTAL_AGENTS = 100; // Total agents in tournament
const AGENTS_PER_GAME = 10; // Game requires exactly 10 agents
const TOTAL_GAMES = TOTAL_AGENTS / AGENTS_PER_GAME; // 10 games

// Agent name generator
const PREFIXES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega', 'Sigma', 'Nova', 'Stellar', 'Cosmic', 'Quantum'];
const SUFFIXES = ['Bot', 'Mind', 'Core', 'Prime', 'Max', 'Pro', 'Ultra', 'Neo', 'Apex', 'Zero'];
const STYLES = [
  'analytical and logical',
  'aggressive and accusatory', 
  'quiet and observant',
  'social and alliance-building',
  'skeptical and questioning',
  'dramatic and emotional',
  'calm and calculated',
  'mysterious and cryptic',
  'optimistic and friendly',
  'defensive and cautious'
];

function generateAgentName(index) {
  const prefix = PREFIXES[index % PREFIXES.length];
  const suffix = SUFFIXES[Math.floor(index / PREFIXES.length) % SUFFIXES.length];
  const num = Math.floor(index / (PREFIXES.length * SUFFIXES.length)) + 1;
  return num > 1 ? `${prefix}${suffix}${num}` : `${prefix}${suffix}`;
}

// HTTP helper
function request(method, url, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };

    const httpModule = isHttps ? https : http;
    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// OpenAI call
async function callAI(systemPrompt, userPrompt, maxTokens = 150) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.9,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Load or create 100 agents for tournament
async function loadOrCreateAgents() {
  // Check if agents file exists with enough agents
  if (fs.existsSync(AGENTS_FILE)) {
    console.log('📂 Loading agents from tournament-agents.json...');
    const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    
    if (agents.length >= TOTAL_AGENTS) {
      const tournamentAgents = agents.slice(0, TOTAL_AGENTS);
      console.log(`✅ Loaded ${tournamentAgents.length} agents for ${TOTAL_GAMES} games\n`);
      return tournamentAgents;
    } else {
      console.log(`⚠️ Found ${agents.length} agents, need ${TOTAL_AGENTS}. Creating more...\n`);
    }
  }

  console.log(`🆕 Creating ${TOTAL_AGENTS} agents for tournament...\n`);
  
  // Load existing agents if any
  let agents = [];
  if (fs.existsSync(AGENTS_FILE)) {
    agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
  }
  
  const startIndex = agents.length;
  
  for (let i = startIndex; i < TOTAL_AGENTS; i++) {
    const name = generateAgentName(i);
    const style = STYLES[i % STYLES.length];

    try {
      const { data } = await request('POST', `${API_BASE}/agents/register`, {
        agent_name: name,
        ai_model: MODEL
      });

      if (data.api_key) {
        agents.push({
          id: data.agent_id,
          name,
          apiKey: data.api_key,
          style
        });
        console.log(`   ✅ [${agents.length}/${TOTAL_AGENTS}] Created ${name}`);
      }
    } catch (err) {
      console.log(`   ❌ Failed to create ${name}: ${err.message}`);
    }

    await sleep(50); // Rate limiting
    
    // Save progress every 10 agents
    if (agents.length % 10 === 0) {
      fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
    }
  }

  console.log(`\n✅ Total: ${agents.length} agents ready\n`);

  // Save final list
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
  console.log(`💾 Saved agents to tournament-agents.json\n`);

  return agents;
}

// Tournament Bot class
class TournamentBot {
  constructor(agentData) {
    this.id = agentData.id;
    this.name = agentData.name;
    this.apiKey = agentData.apiKey;
    this.style = agentData.style;
    this.socket = null;
    this.gameId = null;
    this.role = null;
    this.status = 'alive';
    this.context = {
      agents: [],
      traitorTeammates: [],
      chatHistory: [],
      deaths: [],
      round: 0,
      phase: null
    };
    this.gameEnded = false;
  }

  log(msg) {
    const roleTag = this.role ? (this.role === 'traitor' ? '🔴' : '🟢') : '⚪';
    console.log(`${roleTag} [${this.name}] ${msg}`);
  }

  async connect() {
    return new Promise((resolve) => {
      this.socket = io(WS_URL, { transports: ['websocket'] });

      this.socket.on('connect', () => {
        this.socket.emit('authenticate', { apiKey: this.apiKey });
      });

      this.socket.on('authenticated', () => {
        this.log('Connected & authenticated');
        resolve(true);
      });
      
      this.socket.on('auth_error', (err) => {
        this.log(`Auth error: ${err.message || err}`);
        resolve(false);
      });

      this.socket.on('game_matched', (data) => {
        this.gameId = data.gameId;
        this.role = data.role;
        this.context.agents = data.agents.map(a => ({ ...a, status: 'alive' }));
        this.log(`🎮 MATCHED as ${data.role.toUpperCase()}`);
        this.socket.emit('join_game', data.gameId);
      });

      this.socket.on('game_state', (state) => {
        this.context.round = state.currentRound;
        this.context.phase = state.currentPhase;
        this.context.traitorTeammates = state.traitorTeammates || [];
        if (this.role === 'traitor' && this.context.traitorTeammates.length > 0) {
          this.log(`Traitor teammate: ${this.context.traitorTeammates.map(t => t.name).join(', ')}`);
        }
      });

      this.socket.on('phase_change', async (data) => {
        this.context.phase = data.phase;
        this.context.round = data.round;
        if (data.phase === 'discussion') {
          console.log(`\n📢 ═══════ ROUND ${data.round} - DISCUSSION ═══════\n`);
        }
        await this.handlePhase(data.phase);
      });

      this.socket.on('chat_message', (data) => {
        if (data.agentName !== this.name) {
          this.context.chatHistory.push({
            name: data.agentName,
            message: data.message
          });
        }
      });

      this.socket.on('agent_died', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'murdered' });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) agent.status = 'murdered';
        console.log(`💀 ${data.agentName} was MURDERED!`);
      });

      this.socket.on('banishment_pending', (data) => {
        console.log(`\n⚖️ ${data.agentName} is about to be banished...`);
      });

      this.socket.on('agent_banished', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'banished', role: data.role });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) {
          agent.status = 'banished';
          agent.role = data.role;
        }
        const wasTraitor = data.role === 'traitor';
        console.log(`🗳️ ${data.agentName} was BANISHED! They were ${wasTraitor ? '🔴 a TRAITOR!' : '🟢 an INNOCENT...'}`);
      });

      this.socket.on('no_banishment', (data) => {
        console.log(`⚖️ No banishment - ${data.message || 'no majority'}`);
      });

      this.socket.on('you_eliminated', (data) => {
        this.status = 'eliminated';
        this.log(`☠️ ELIMINATED: ${data.reason}`);
      });

      this.socket.on('game_ended', (data) => {
        this.gameEnded = true;
        const won = (data.winner === 'innocents' && this.role === 'innocent') ||
                    (data.winner === 'traitors' && this.role === 'traitor');
        this.log(`🏁 Game Over! ${won ? '🎉 WON' : '❌ LOST'}`);
      });

      this.socket.on('disconnect', () => {
        if (!this.gameEnded) {
          this.log('Disconnected unexpectedly');
        }
      });

      setTimeout(() => resolve(false), 15000);
    });
  }

  async joinLobby() {
    const result = await request('POST', `${API_BASE}/lobby/join`, {}, {
      'Authorization': `Bearer ${this.apiKey}`
    });
    return result.status === 200 || result.status === 201;
  }

  async handlePhase(phase) {
    if (this.status === 'eliminated') return;
    await sleep(Math.random() * 1500 + 500);

    switch (phase) {
      case 'murder':
        if (this.role === 'traitor') await this.doMurder();
        break;
      case 'discussion':
        await this.doDiscussion();
        break;
      case 'voting':
        await this.doVote();
        break;
    }
  }

  async doMurder() {
    const innocents = this.context.agents.filter(a => 
      a.status === 'alive' && a.id !== this.id && 
      !this.context.traitorTeammates.some(t => t.id === a.id)
    );
    if (innocents.length === 0) return;

    const target = innocents[Math.floor(Math.random() * innocents.length)];
    this.log(`🗡️ Attempting to murder ${target.name}...`);
    try {
      await request('POST', `${API_BASE}/game/${this.gameId}/murder`,
        { targetId: target.id },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
    } catch {}
  }

  async doDiscussion() {
    // Wait random time before speaking
    await sleep(Math.random() * 6000 + 2000);
    if (this.status === 'eliminated' || this.context.phase !== 'discussion') return;

    try {
      const message = await this.generateMessage();
      if (message) {
        console.log(`💬 ${this.name}: ${message}`);
        await request('POST', `${API_BASE}/game/${this.gameId}/chat`,
          { message, channel: 'general' },
          { 'Authorization': `Bearer ${this.apiKey}` }
        );
      }
    } catch (err) {
      this.log(`Chat error: ${err.message}`);
    }
  }

  async generateMessage() {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-10);

    const prompt = `You are ${this.name}, ${this.style}. Role: ${this.role?.toUpperCase()}.
${this.role === 'traitor' ? `Your traitor teammate: ${this.context.traitorTeammates.map(t => t.name).join(', ') || 'none'}. Deceive others and deflect suspicion!` : 'You must find and vote out the 2 traitors to win!'}

Alive players: ${alive.map(a => a.name).join(', ')}
Dead so far: ${this.context.deaths.map(d => `${d.name}(${d.cause}${d.role ? ', was ' + d.role : ''})`).join(', ') || 'none'}

Recent chat:
${recent.map(m => `${m.name}: ${m.message}`).join('\n') || '(silence)'}

Write ONE short message (1-2 sentences max) as ${this.name}. Stay in character with your ${this.style} style. ${this.role === 'traitor' ? 'Blend in, maybe accuse someone else.' : 'Share suspicions or defend yourself if accused.'}`;

    try {
      const response = await callAI('You are playing a social deduction game. Respond only with your in-character message.', prompt, 80);
      return response.trim().replace(/^["']|["']$/g, '').replace(/^.*?:\s*/, '');
    } catch (err) {
      return null;
    }
  }

  async doVote() {
    await sleep(Math.random() * 4000 + 1000);
    if (this.status === 'eliminated') return;

    const candidates = this.context.agents.filter(a => 
      a.status === 'alive' && a.id !== this.id
    );
    if (candidates.length === 0) return;

    let target;
    let rationale;

    if (this.role === 'traitor') {
      // Traitors vote for innocents
      const innocents = candidates.filter(a => 
        !this.context.traitorTeammates.some(t => t.id === a.id)
      );
      target = innocents.length > 0 
        ? innocents[Math.floor(Math.random() * innocents.length)] 
        : candidates[0];
      rationale = 'They seem suspicious to me';
    } else {
      // Innocents try to find traitors (random for now, AI could improve this)
      target = candidates[Math.floor(Math.random() * candidates.length)];
      rationale = 'Something feels off about them';
    }

    this.log(`🗳️ Voting for ${target.name}`);
    try {
      await request('POST', `${API_BASE}/game/${this.gameId}/vote`,
        { targetId: target.id, rationale },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
    } catch {}
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Run tournament with all agents forming multiple games
async function runTournament(agents) {
  console.log('\n🎮 ════════════════════════════════════════════════════════');
  console.log('   TOURNAMENT MODE - 100 AGENTS, 10 GAMES');
  console.log('   ════════════════════════════════════════════════════════\n');
  console.log(`   👥 Total Players: ${agents.length}`);
  console.log(`   🎲 Games to play: ${TOTAL_GAMES}\n`);

  const bots = agents.map(a => new TournamentBot(a));
  const gameResults = new Map(); // gameId -> { winner, traitors, innocents }

  // Track games per bot for results
  bots.forEach(bot => {
    bot.on = bot.socket?.on; // Will be set after connect
  });

  // Connect all bots in parallel batches
  console.log('🔌 Connecting all agents...\n');
  const BATCH_SIZE = 20;
  for (let i = 0; i < bots.length; i += BATCH_SIZE) {
    const batch = bots.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (bot) => {
      const connected = await bot.connect();
      if (!connected) {
        console.log(`   ❌ Failed: ${bot.name}`);
      }
    }));
    console.log(`   ✅ Connected ${Math.min(i + BATCH_SIZE, bots.length)}/${bots.length}`);
    await sleep(200);
  }

  // Join lobby - all at once
  console.log('\n🚪 All agents joining lobby...\n');
  let joinedCount = 0;
  for (let i = 0; i < bots.length; i += BATCH_SIZE) {
    const batch = bots.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (bot) => {
      const joined = await bot.joinLobby();
      if (joined) joinedCount++;
    }));
    console.log(`   📋 In lobby: ${joinedCount}/${bots.length}`);
    await sleep(100);
  }

  console.log(`\n   ✅ ${joinedCount} agents in lobby, ready to match!\n`);

  // Wait for automatic matchmaking and monitor progress
  console.log('⏳ Waiting for games to start...\n');
  
  // Poll for game assignments
  let waitTime = 0;
  const maxWait = 30000; // 30 seconds max wait
  while (waitTime < maxWait) {
    await sleep(2000);
    waitTime += 2000;
    
    const matchedBots = bots.filter(b => b.gameId);
    const uniqueGames = new Set(matchedBots.map(b => b.gameId));
    
    console.log(`   📊 ${matchedBots.length}/${bots.length} agents matched into ${uniqueGames.size} games`);
    
    // Check lobby status
    try {
      const lobbyStatus = await request('GET', `${API_BASE}/lobby/status`);
      if (lobbyStatus.data) {
        console.log(`   📋 Queue: ${lobbyStatus.data.queueSize}/10 | Active games: ${lobbyStatus.data.activeGames}`);
      }
    } catch {}
    
    // If all agents are matched, we're good
    if (matchedBots.length === bots.length) {
      console.log(`\n   ✅ All agents matched!\n`);
      break;
    }
    
    // If queue still has agents after 10 seconds, something's wrong
    if (waitTime >= 10000 && matchedBots.length < bots.length) {
      console.log(`\n   ⚠️ Not all agents matched after ${waitTime/1000}s. Checking lobby...`);
    }
  }
  
  const matchedBots = bots.filter(b => b.gameId);
  const uniqueGames = new Set(matchedBots.map(b => b.gameId));
  console.log(`\n   🎮 ${uniqueGames.size} games started with ${matchedBots.length} agents\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Wait for all games to finish (max 20 min for tournament)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('\n⏰ Tournament timeout (20 min)\n');
      bots.forEach(b => b.disconnect());
      resolve(gameResults);
    }, 20 * 60 * 1000);

    // Check if all bots have finished their games
    const checkInterval = setInterval(() => {
      const allEnded = bots.every(b => b.gameEnded || !b.socket?.connected);
      const gamesCompleted = bots.filter(b => b.gameEnded).length;
      
      if (allEnded || gamesCompleted === bots.length) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        
        // Collect results by game
        const gameGroups = new Map();
        bots.forEach(bot => {
          if (bot.gameId) {
            if (!gameGroups.has(bot.gameId)) {
              gameGroups.set(bot.gameId, []);
            }
            gameGroups.get(bot.gameId).push(bot);
          }
        });

        // Print tournament results
        console.log('\n════════════════════════════════════════════════════════');
        console.log('   🏆 TOURNAMENT RESULTS');
        console.log('   ════════════════════════════════════════════════════════\n');
        
        let gameNum = 1;
        let traitorWins = 0;
        let innocentWins = 0;
        
        gameGroups.forEach((gameBots, gameId) => {
          const traitors = gameBots.filter(b => b.role === 'traitor');
          const innocents = gameBots.filter(b => b.role === 'innocent');
          
          const traitorsAlive = traitors.filter(t => t.status === 'alive').length;
          const innocentsAlive = innocents.filter(i => i.status === 'alive').length;
          
          // Determine winner
          let winner = 'unknown';
          if (traitorsAlive === 0) {
            winner = 'innocents';
            innocentWins++;
          } else if (innocentsAlive === 0) {
            winner = 'traitors';
            traitorWins++;
          } else if (traitorsAlive > 0 && innocentsAlive > 0) {
            // Game might still be running or ended differently
            winner = traitorsAlive >= innocentsAlive ? 'traitors' : 'innocents';
            if (winner === 'traitors') traitorWins++; else innocentWins++;
          }
          
          console.log(`   📍 GAME ${gameNum} - Winner: ${winner === 'traitors' ? '🔴 TRAITORS' : '🟢 INNOCENTS'}`);
          console.log(`      Traitors: ${traitors.map(t => `${t.name}(${t.status})`).join(', ')}`);
          console.log(`      Survivors: ${gameBots.filter(b => b.status === 'alive').map(b => b.name).join(', ') || 'none'}\n`);
          
          gameNum++;
        });
        
        console.log('   ════════════════════════════════════════════════════════');
        console.log(`   📊 FINAL SCORE: Innocents ${innocentWins} - ${traitorWins} Traitors`);
        console.log('   ════════════════════════════════════════════════════════\n');
        
        bots.forEach(b => b.disconnect());
        resolve({ innocentWins, traitorWins, totalGames: gameGroups.size });
      }
    }, 3000);
  });
}

// Main
async function main() {
  console.log('\n🏆 ═══════════════════════════════════════════════════════');
  console.log('   AMONGCLAWDS TOURNAMENT');
  console.log(`   ${TOTAL_AGENTS} Agents | ${TOTAL_GAMES} Games | May the best team win!`);
  console.log('   ═══════════════════════════════════════════════════════\n');

  // Check server
  try {
    const healthUrl = `${API_BASE.replace('/api/v1', '')}/health`;
    const httpModule = healthUrl.startsWith('https') ? https : http;
    await new Promise((resolve, reject) => {
      httpModule.get(healthUrl, (res) => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Status ${res.statusCode}`));
      }).on('error', reject);
    });
    console.log('✅ Server connected\n');
  } catch (err) {
    console.log(`❌ Server not reachable: ${err.message}\n`);
    process.exit(1);
  }

  // Reset lobby and clean stale games before starting
  console.log('🧹 Cleaning up lobby and stale games...\n');
  try {
    const resetResult = await request('POST', `${API_BASE}/lobby/reset`);
    if (resetResult.status === 200) {
      console.log(`   ✅ Queue cleared`);
      console.log(`   ✅ Stale games cleaned: ${resetResult.data.staleGamesCleaned || 0}`);
      console.log(`   📊 Active games remaining: ${resetResult.data.activeGamesRemaining || 0}\n`);
    }
  } catch (err) {
    console.log(`   ⚠️ Reset failed: ${err.message} (continuing anyway)\n`);
  }

  // Load or create agents
  const agents = await loadOrCreateAgents();

  if (agents.length < TOTAL_AGENTS) {
    console.log(`❌ Need ${TOTAL_AGENTS} agents, found ${agents.length}\n`);
    process.exit(1);
  }

  // Run the tournament
  const results = await runTournament(agents);

  console.log('🏆 ═══════════════════════════════════════════════════════');
  console.log('   TOURNAMENT COMPLETE!');
  if (results) {
    console.log(`   🟢 Innocents won: ${results.innocentWins} games`);
    console.log(`   🔴 Traitors won: ${results.traitorWins} games`);
  }
  console.log('   ═══════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
