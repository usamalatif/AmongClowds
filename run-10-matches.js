#!/usr/bin/env node

/**
 * AmongClawds - 10 Match Runner
 * 
 * Fetches existing agents from database and runs 10 consecutive matches.
 * Tracks statistics across all matches.
 * 
 * Usage: node run-10-matches.js [--matches=N]
 */

require('dotenv').config();

const { Pool } = require('pg');
const http = require('http');
const https = require('https');
const { io } = require('socket.io-client');

// Configuration
const API_BASE = process.env.API_BASE || 'https://api.amongclawds.com/api/v1';
const WS_URL = process.env.WS_URL || 'https://api.amongclawds.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:mREQydRTToRjVSKuGfbbLeIeskKorzWv@shinkansen.proxy.rlwy.net:51638/railway';
const MODEL = 'gpt-4o-mini';

// Parse command line args
const args = process.argv.slice(2);
const TOTAL_MATCHES = parseInt(args.find(a => a.startsWith('--matches='))?.split('=')[1]) || 10;
const AGENTS_PER_MATCH = 12;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set. Create .env file or set env var.');
  process.exit(1);
}

// Database connection
const pool = new Pool({ connectionString: DATABASE_URL });

// Stats tracking
const stats = {
  totalMatches: 0,
  completed: 0,
  abandoned: 0,
  innocentWins: 0,
  traitorWins: 0,
  totalRounds: 0,
  agentStats: new Map(), // name -> { played, won, asTraitor, asInnocent }
  matchResults: []
};

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

// Personality styles for agents
const STYLES = [
  'analytical and logical',
  'aggressive and accusatory',
  'quiet and observant',
  'social and friendly',
  'skeptical and questioning',
  'dramatic and emotional',
  'calm and calculated',
  'mysterious and cryptic',
  'optimistic and cheerful',
  'defensive and cautious',
  'witty and sarcastic',
  'paranoid and suspicious'
];

// Fetch existing agents from database
async function fetchExistingAgents(limit = 50) {
  console.log('\n📦 Fetching existing agents from database...\n');
  
  const result = await pool.query(
    `SELECT id, agent_name, api_key 
     FROM agents 
     WHERE api_key IS NOT NULL
     ORDER BY total_games DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );

  const agents = result.rows.map((row, i) => ({
    id: row.id,
    name: row.agent_name,
    apiKey: row.api_key,
    style: STYLES[i % STYLES.length]
  }));

  console.log(`   Found ${agents.length} agents\n`);
  return agents;
}

// Bot class
class GameBot {
  constructor(agentData, matchNum) {
    this.id = agentData.id;
    this.name = agentData.name;
    this.apiKey = agentData.apiKey;
    this.style = agentData.style;
    this.matchNum = matchNum;
    this.socket = null;
    this.gameId = null;
    this.role = null;
    this.status = 'alive';
    this.context = {
      agents: [],
      traitorTeammates: [],
      chatHistory: [],
      deaths: [],
      votes: [],
      round: 0,
      phase: null
    };
    this.gameEnded = false;
    this.winner = null;
  }

  log(msg) {
    const roleTag = this.role ? (this.role === 'traitor' ? '🔴' : '🟢') : '⚪';
    console.log(`[M${this.matchNum}] ${roleTag} [${this.name}] ${msg}`);
  }

  async connect() {
    return new Promise((resolve) => {
      this.socket = io(WS_URL, { transports: ['websocket'] });

      this.socket.on('connect', () => {
        this.socket.emit('authenticate', { apiKey: this.apiKey });
      });

      this.socket.on('authenticated', () => {
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

      this.socket.on('game_state', async (state) => {
        this.context.round = state.currentRound;
        this.context.phase = state.currentPhase;
        this.context.traitorTeammates = state.traitorTeammates || [];
        if (state.currentPhase && state.currentPhase !== 'waiting' && state.currentPhase !== 'reveal') {
          await this.handlePhase(state.currentPhase);
        }
      });

      this.socket.on('phase_change', async (data) => {
        this.context.phase = data.phase;
        this.context.round = data.round;
        await this.handlePhase(data.phase);
      });

      this.socket.on('chat_message', (data) => {
        if (data.agentName !== this.name) {
          this.context.chatHistory.push({ name: data.agentName, message: data.message });
        }
      });

      this.socket.on('vote_cast', (data) => {
        this.context.votes.push({
          round: this.context.round,
          voter: data.voterName,
          target: data.targetName,
          rationale: data.rationale
        });
      });

      this.socket.on('agent_died', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'murdered', round: this.context.round });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) agent.status = 'murdered';
      });

      this.socket.on('agent_banished', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'banished', role: data.role, round: this.context.round });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) {
          agent.status = 'banished';
          agent.role = data.role;
        }
      });

      this.socket.on('you_eliminated', (data) => {
        this.status = 'eliminated';
        this.log(`☠️ ELIMINATED: ${data.reason}`);
      });

      this.socket.on('game_ended', (data) => {
        this.gameEnded = true;
        this.winner = data.winner;
        const won = (data.winner === 'innocents' && this.role === 'innocent') ||
                    (data.winner === 'traitors' && this.role === 'traitor');
        this.log(`🏁 ${won ? '🎉 WON' : '❌ LOST'} (${data.winner})`);
      });

      this.socket.on('disconnect', () => {});
      this.socket.on('error', () => {});
      this.socket.on('connect_error', () => {});

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
    const delay = Math.random() * 2000 + 500;
    await sleep(delay);

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
    this.log(`🗡️ Targeting ${target.name}`);
    try {
      await request('POST', `${API_BASE}/game/${this.gameId}/murder`,
        { targetId: target.id },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
    } catch {}
  }

  async doDiscussion() {
    const messageCount = Math.floor(Math.random() * 2) + 1;
    
    for (let i = 0; i < messageCount; i++) {
      const waitTime = Math.random() * 15000 + 5000;
      await sleep(waitTime);
      if (this.status === 'eliminated' || this.context.phase !== 'discussion') return;

      try {
        const message = await this.generateMessage();
        if (message) {
          await request('POST', `${API_BASE}/game/${this.gameId}/chat`,
            { message, channel: 'general' },
            { 'Authorization': `Bearer ${this.apiKey}` }
          );
        }
      } catch {}
    }
  }

  async generateMessage() {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-15);

    const prompt = `You are ${this.name}, playing a social deduction game. Your style: ${this.style}.
Role: ${this.role?.toUpperCase()}
${this.role === 'traitor' ? `Your traitor partner: ${this.context.traitorTeammates.map(t => t.name).join(', ') || 'unknown'}. DECEIVE others!` : 'Find the 2 traitors!'}

Round: ${this.context.round}
Alive: ${alive.map(a => a.name).join(', ')}
Dead: ${this.context.deaths.map(d => `${d.name}(${d.cause})`).join(', ') || 'none'}

Recent chat:
${recent.map(m => `${m.name}: ${m.message}`).join('\n') || '(silence)'}

Write ONE message (1-2 sentences). Stay in character.`;

    try {
      const response = await callAI('You are playing AmongClawds. Respond only with your message.', prompt, 100);
      return response.trim().replace(/^["']|["']$/g, '').replace(/^.*?:\s*/, '');
    } catch {
      return null;
    }
  }

  async doVote() {
    const waitTime = Math.random() * 8000 + 2000;
    await sleep(waitTime);
    if (this.status === 'eliminated') return;

    const candidates = this.context.agents.filter(a => a.status === 'alive' && a.id !== this.id);
    if (candidates.length === 0) return;

    let target;
    let rationale;

    try {
      const voteDecision = await this.generateVoteDecision(candidates);
      if (voteDecision) {
        const found = candidates.find(c => 
          c.name.toLowerCase().includes(voteDecision.target.toLowerCase()) ||
          voteDecision.target.toLowerCase().includes(c.name.toLowerCase())
        );
        if (found) {
          target = found;
          rationale = voteDecision.rationale;
        }
      }
    } catch {}

    if (!target) {
      if (this.role === 'traitor') {
        const innocents = candidates.filter(a => !this.context.traitorTeammates.some(t => t.id === a.id));
        target = innocents.length > 0 ? innocents[Math.floor(Math.random() * innocents.length)] : candidates[0];
      } else {
        target = candidates[Math.floor(Math.random() * candidates.length)];
      }
      rationale = 'Something feels off';
    }

    this.log(`🗳️ Voting for ${target.name}`);
    try {
      await request('POST', `${API_BASE}/game/${this.gameId}/vote`,
        { targetId: target.id, rationale },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
    } catch {}
  }

  async generateVoteDecision(candidates) {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-20);

    const prompt = `You are ${this.name}. Role: ${this.role?.toUpperCase()}.
${this.role === 'traitor' ? `Partner: ${this.context.traitorTeammates.map(t => t.name).join(', ')}. Vote for an INNOCENT!` : 'Vote for who you think is a traitor!'}

Alive: ${alive.map(a => a.name).join(', ')}
Dead: ${this.context.deaths.map(d => `${d.name}(${d.role || d.cause})`).join(', ') || 'none'}

Chat:
${recent.map(m => `${m.name}: ${m.message}`).join('\n') || 'none'}

Reply:
TARGET: <name>
REASON: <short reason>`;

    const response = await callAI('Vote. Reply TARGET and REASON only.', prompt, 80);
    const targetMatch = response.match(/TARGET:\s*(\w+)/i);
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    
    if (targetMatch) {
      return { target: targetMatch[1], rationale: reasonMatch ? reasonMatch[1].trim() : 'Suspicious' };
    }
    return null;
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
  }
}

// Run a single match
async function runMatch(matchNum, allAgents) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`   🎮 MATCH ${matchNum}/${TOTAL_MATCHES}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Pick random agents for this match
  const shuffled = [...allAgents].sort(() => Math.random() - 0.5);
  const matchAgents = shuffled.slice(0, AGENTS_PER_MATCH);

  console.log(`   Players: ${matchAgents.map(a => a.name).join(', ')}\n`);

  // Create bots
  const bots = matchAgents.map(a => new GameBot(a, matchNum));

  // Connect all
  console.log('   🔌 Connecting...\n');
  for (const bot of bots) {
    await bot.connect();
    await sleep(50);
  }

  // Join lobby
  let joinedCount = 0;
  for (const bot of bots) {
    const joined = await bot.joinLobby();
    if (joined) joinedCount++;
    await sleep(50);
  }

  console.log(`   📋 ${joinedCount}/${bots.length} in lobby\n`);
  console.log('   ⏳ Waiting for game...\n');

  // Wait for game to finish
  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`\n   ⏰ Match ${matchNum} timeout (15 min)\n`);
      bots.forEach(b => b.disconnect());
      resolve({ completed: false, winner: null, rounds: 0 });
    }, 15 * 60 * 1000);

    const checkInterval = setInterval(() => {
      const matched = bots.filter(b => b.gameId);
      const ended = bots.filter(b => b.gameEnded);
      
      if (matched.length > 0 && ended.length === matched.length) {
        clearTimeout(timeout);
        clearInterval(checkInterval);

        const winner = bots.find(b => b.winner)?.winner || 'abandoned';
        const rounds = Math.max(...bots.map(b => b.context.round || 0));

        // Print results
        console.log(`\n   🏁 MATCH ${matchNum} COMPLETE: ${winner.toUpperCase()} WIN\n`);

        const traitors = bots.filter(b => b.role === 'traitor');
        const innocents = bots.filter(b => b.role === 'innocent');

        console.log('   🔴 Traitors:');
        traitors.forEach(t => {
          const status = t.status === 'alive' ? '✅' : `☠️`;
          console.log(`      ${status} ${t.name}`);
        });

        console.log('   🟢 Innocents:');
        innocents.forEach(i => {
          const status = i.status === 'alive' ? '✅' : `☠️`;
          console.log(`      ${status} ${i.name}`);
        });

        // Update stats
        bots.forEach(b => {
          if (!stats.agentStats.has(b.name)) {
            stats.agentStats.set(b.name, { played: 0, won: 0, asTraitor: 0, asInnocent: 0 });
          }
          const s = stats.agentStats.get(b.name);
          s.played++;
          if (b.role === 'traitor') s.asTraitor++;
          else s.asInnocent++;
          if ((winner === 'traitors' && b.role === 'traitor') ||
              (winner === 'innocents' && b.role === 'innocent')) {
            s.won++;
          }
        });

        bots.forEach(b => b.disconnect());
        resolve({ completed: true, winner, rounds });
      }
    }, 3000);
  });

  return result;
}

// Main
async function main() {
  console.log('\n🎮 ═══════════════════════════════════════════════════════');
  console.log(`   AMONGCLAWDS - ${TOTAL_MATCHES} MATCH RUNNER`);
  console.log('   ═══════════════════════════════════════════════════════\n');

  // Check server
  try {
    const healthUrl = `${API_BASE.replace('/api/v1', '')}/health`;
    await new Promise((resolve, reject) => {
      const httpModule = healthUrl.startsWith('https') ? https : http;
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

  // Fetch existing agents
  const allAgents = await fetchExistingAgents(50);
  
  if (allAgents.length < AGENTS_PER_MATCH) {
    console.log(`❌ Need at least ${AGENTS_PER_MATCH} agents, found ${allAgents.length}\n`);
    process.exit(1);
  }

  console.log(`   Using ${allAgents.length} agents for ${TOTAL_MATCHES} matches\n`);

  // Run matches
  for (let i = 1; i <= TOTAL_MATCHES; i++) {
    const result = await runMatch(i, allAgents);
    
    stats.totalMatches++;
    if (result.completed) {
      stats.completed++;
      stats.totalRounds += result.rounds;
      if (result.winner === 'innocents') stats.innocentWins++;
      else if (result.winner === 'traitors') stats.traitorWins++;
      else stats.abandoned++;
    } else {
      stats.abandoned++;
    }

    stats.matchResults.push(result);

    // Brief pause between matches
    if (i < TOTAL_MATCHES) {
      console.log('\n   ⏸️  5 second break...\n');
      await sleep(5000);
    }
  }

  // Final stats
  console.log('\n' + '═'.repeat(60));
  console.log('   📊 FINAL STATISTICS');
  console.log('═'.repeat(60) + '\n');

  console.log(`   Total Matches: ${stats.totalMatches}`);
  console.log(`   Completed: ${stats.completed}`);
  console.log(`   Abandoned: ${stats.abandoned}`);
  console.log(`\n   🟢 Innocent Wins: ${stats.innocentWins} (${Math.round(stats.innocentWins / stats.completed * 100) || 0}%)`);
  console.log(`   🔴 Traitor Wins: ${stats.traitorWins} (${Math.round(stats.traitorWins / stats.completed * 100) || 0}%)`);
  console.log(`   Avg Rounds: ${(stats.totalRounds / stats.completed).toFixed(1) || 0}`);

  // Top agents
  console.log('\n   🏆 Top Agents by Win Rate:\n');
  const agentArray = [...stats.agentStats.entries()]
    .map(([name, s]) => ({ name, ...s, winRate: s.played > 0 ? s.won / s.played : 0 }))
    .filter(a => a.played >= 2)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10);

  agentArray.forEach((a, i) => {
    console.log(`      ${i + 1}. ${a.name}: ${Math.round(a.winRate * 100)}% (${a.won}/${a.played})`);
  });

  console.log('\n' + '═'.repeat(60) + '\n');

  await pool.end();
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down...\n');
  await pool.end();
  process.exit(0);
});

main().catch(async (err) => {
  console.error('Fatal:', err);
  await pool.end();
  process.exit(1);
});
