#!/usr/bin/env node

/**
 * AmongClawds - Single Game Runner
 * 
 * Creates 12 agents with random names and plays one game.
 * Run multiple instances to fill more games!
 * 
 * Usage: node play-game.js
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';
const AGENT_COUNT = 12;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set. Create .env file or set env var.');
  process.exit(1);
}

// Generate unique instance ID for this run
const INSTANCE_ID = Math.random().toString(36).slice(2, 6).toUpperCase();
const AGENTS_FILE = path.join(__dirname, `game-agents-${INSTANCE_ID}.json`);

// Random name generators
const ADJECTIVES = ['Swift', 'Dark', 'Bright', 'Silent', 'Wild', 'Clever', 'Bold', 'Sly', 'Quick', 'Sharp', 'Calm', 'Fierce', 'Wise', 'Lucky', 'Mystic'];
const NOUNS = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Lion', 'Owl', 'Viper', 'Tiger', 'Raven', 'Ghost', 'Storm', 'Blade', 'Shadow', 'Flame', 'Frost'];
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

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999);
  return `${adj}${noun}${num}`;
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

// Create agents with random names
async function createAgents() {
  console.log(`\n🎲 Creating ${AGENT_COUNT} agents with random names...\n`);
  const agents = [];

  for (let i = 0; i < AGENT_COUNT; i++) {
    const name = generateRandomName();
    const style = STYLES[i % STYLES.length];

    try {
      const { status, data } = await request('POST', `${API_BASE}/agents/register`, {
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
        console.log(`   ✅ ${name}`);
      } else if (status === 400 && data.error?.includes('taken')) {
        // Name taken, try again with different name
        i--;
        continue;
      } else {
        console.log(`   ❌ ${name}: ${data.error || 'failed'}`);
      }
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
    }

    await sleep(50);
  }

  // Save agents for this instance
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
  console.log(`\n💾 Saved to ${AGENTS_FILE}\n`);

  return agents;
}

// Bot class
class GameBot {
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
      votes: [],
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
        this.log(`📡 game_state: phase=${state.currentPhase}, round=${state.currentRound}`);
        this.context.round = state.currentRound;
        this.context.phase = state.currentPhase;
        this.context.traitorTeammates = state.traitorTeammates || [];
        if (this.role === 'traitor' && this.context.traitorTeammates.length > 0) {
          this.log(`Partner: ${this.context.traitorTeammates.map(t => t.name).join(', ')}`);
        }
        // Trigger phase handler immediately if joining mid-game
        if (state.currentPhase && state.currentPhase !== 'waiting' && state.currentPhase !== 'reveal') {
          await this.handlePhase(state.currentPhase);
        }
      });

      this.socket.on('game_starting', (data) => {
        this.log(`🚀 game_starting in ${data.startsIn}ms`);
      });

      this.socket.on('phase_change', async (data) => {
        this.log(`📢 phase_change event: ${data.phase} (round ${data.round})`);
        this.context.phase = data.phase;
        this.context.round = data.round;
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

      this.socket.on('no_banishment', (data) => {
        // No action needed
      });

      this.socket.on('you_eliminated', (data) => {
        this.status = 'eliminated';
        this.log(`☠️ ELIMINATED: ${data.reason}`);
      });

      this.socket.on('game_ended', (data) => {
        this.gameEnded = true;
        const won = (data.winner === 'innocents' && this.role === 'innocent') ||
                    (data.winner === 'traitors' && this.role === 'traitor');
        this.log(`🏁 ${won ? '🎉 WON' : '❌ LOST'}`);
      });

      this.socket.on('disconnect', (reason) => {
        if (!this.gameEnded) {
          this.log(`Disconnected: ${reason}`);
        }
      });

      this.socket.on('error', (err) => {
        this.log(`Socket error: ${err.message || err}`);
      });

      this.socket.on('connect_error', (err) => {
        this.log(`Connection error: ${err.message || err}`);
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
    this.log(`⚡ handlePhase called: ${phase} (status=${this.status}, role=${this.role})`);
    if (this.status === 'eliminated') {
      this.log(`⚡ Skipping phase ${phase} - eliminated`);
      return;
    }
    const delay = Math.random() * 2000 + 500;
    this.log(`⚡ Waiting ${Math.round(delay)}ms before acting...`);
    await sleep(delay);

    switch (phase) {
      case 'murder':
        if (this.role === 'traitor') {
          await this.doMurder();
        } else {
          this.log(`⚡ Not a traitor, skipping murder phase`);
        }
        break;
      case 'discussion':
        await this.doDiscussion();
        break;
      case 'voting':
        await this.doVote();
        break;
      default:
        this.log(`⚡ Unknown/ignored phase: ${phase}`);
    }
  }

  async doMurder() {
    const innocents = this.context.agents.filter(a =>
      a.status === 'alive' && a.id !== this.id &&
      !this.context.traitorTeammates.some(t => t.id === a.id)
    );
    if (innocents.length === 0) {
      this.log(`🗡️ No valid targets for murder`);
      return;
    }

    const target = innocents[Math.floor(Math.random() * innocents.length)];
    this.log(`🗡️ Targeting ${target.name}`);
    try {
      const result = await request('POST', `${API_BASE}/game/${this.gameId}/murder`,
        { targetId: target.id },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
      if (result.status !== 200 && result.status !== 201) {
        this.log(`🗡️ Murder failed: ${result.status} - ${JSON.stringify(result.data)}`);
      }
    } catch (err) {
      this.log(`🗡️ Murder error: ${err.message}`);
    }
  }

  async doDiscussion() {
    this.log(`💬 Starting discussion phase...`);
    // Multiple messages during discussion
    const messageCount = Math.floor(Math.random() * 2) + 1;
    
    for (let i = 0; i < messageCount; i++) {
      const waitTime = Math.random() * 15000 + 5000;
      this.log(`💬 Waiting ${Math.round(waitTime/1000)}s before message ${i+1}/${messageCount}...`);
      await sleep(waitTime);
      if (this.status === 'eliminated') {
        this.log(`💬 Eliminated, stopping discussion`);
        return;
      }
      if (this.context.phase !== 'discussion') {
        this.log(`💬 Phase changed to ${this.context.phase}, stopping discussion`);
        return;
      }

      try {
        const message = await this.generateMessage();
        if (message) {
          console.log(`💬 ${this.name}: ${message}`);
          const result = await request('POST', `${API_BASE}/game/${this.gameId}/chat`,
            { message, channel: 'general' },
            { 'Authorization': `Bearer ${this.apiKey}` }
          );
          if (result.status !== 200 && result.status !== 201) {
            this.log(`💬 Chat failed: ${result.status} - ${JSON.stringify(result.data)}`);
          }
        } else {
          this.log(`💬 AI returned no message`);
        }
      } catch (err) {
        this.log(`💬 Chat error: ${err.message}`);
      }
    }
  }

  async generateMessage() {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-15);
    const recentVotes = this.context.votes.filter(v => v.round === this.context.round || v.round === this.context.round - 1);

    const prompt = `You are ${this.name}, playing a social deduction game. Your style: ${this.style}.
Role: ${this.role?.toUpperCase()}
${this.role === 'traitor' ? `Your traitor partner: ${this.context.traitorTeammates.map(t => t.name).join(', ') || 'unknown'}. You must DECEIVE others and avoid suspicion!` : 'Find and vote out the 2 traitors to win!'}

Round: ${this.context.round}
Alive players: ${alive.map(a => a.name).join(', ')}
Dead: ${this.context.deaths.map(d => `${d.name}(${d.cause}${d.role ? ', ' + d.role : ''})`).join(', ') || 'none'}

Recent chat:
${recent.map(m => `${m.name}: ${m.message}`).join('\n') || '(silence)'}

Recent votes:
${recentVotes.map(v => `${v.voter} → ${v.target}`).join(', ') || 'none'}

Write ONE message (1-2 sentences). Stay in character. ${this.role === 'traitor' ? 'Blend in, maybe subtly accuse an innocent.' : 'Share suspicions or respond to accusations.'}`;

    try {
      const response = await callAI('You are playing AmongClawds. Respond only with your in-character message, no quotes.', prompt, 100);
      return response.trim().replace(/^["']|["']$/g, '').replace(/^.*?:\s*/, '');
    } catch {
      return null;
    }
  }

  async doVote() {
    this.log(`🗳️ Starting voting phase...`);
    const waitTime = Math.random() * 8000 + 2000;
    this.log(`🗳️ Waiting ${Math.round(waitTime/1000)}s before voting...`);
    await sleep(waitTime);
    if (this.status === 'eliminated') {
      this.log(`🗳️ Eliminated, skipping vote`);
      return;
    }

    const candidates = this.context.agents.filter(a =>
      a.status === 'alive' && a.id !== this.id
    );
    if (candidates.length === 0) {
      this.log(`🗳️ No candidates to vote for`);
      return;
    }

    let target;
    let rationale;

    // AI-powered voting decision
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
    } catch { }

    // Fallback to random if AI fails
    if (!target) {
      if (this.role === 'traitor') {
        const innocents = candidates.filter(a =>
          !this.context.traitorTeammates.some(t => t.id === a.id)
        );
        target = innocents.length > 0
          ? innocents[Math.floor(Math.random() * innocents.length)]
          : candidates[0];
      } else {
        target = candidates[Math.floor(Math.random() * candidates.length)];
      }
      rationale = 'Something feels off about them';
    }

    this.log(`🗳️ Voting for ${target.name} - "${rationale}"`);
    try {
      const result = await request('POST', `${API_BASE}/game/${this.gameId}/vote`,
        { targetId: target.id, rationale },
        { 'Authorization': `Bearer ${this.apiKey}` }
      );
      if (result.status !== 200 && result.status !== 201) {
        this.log(`🗳️ Vote failed: ${result.status} - ${JSON.stringify(result.data)}`);
      } else {
        this.log(`🗳️ Vote submitted successfully`);
      }
    } catch (err) {
      this.log(`🗳️ Vote error: ${err.message}`);
    }
  }

  async generateVoteDecision(candidates) {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-20);

    const prompt = `You are ${this.name}. Role: ${this.role?.toUpperCase()}.
${this.role === 'traitor' ? `Partner: ${this.context.traitorTeammates.map(t => t.name).join(', ')}. Vote for an INNOCENT, not your partner!` : 'Vote for who you think is a traitor!'}

Alive: ${alive.map(a => a.name).join(', ')}
Dead: ${this.context.deaths.map(d => `${d.name}(${d.role || d.cause})`).join(', ') || 'none'}

Chat history:
${recent.map(m => `${m.name}: ${m.message}`).join('\n') || 'none'}

Who do you vote for and why? Reply in format:
TARGET: <name>
REASON: <short reason>`;

    const response = await callAI('Vote decision. Reply only with TARGET and REASON.', prompt, 80);
    
    const targetMatch = response.match(/TARGET:\s*(\w+)/i);
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    
    if (targetMatch) {
      return {
        target: targetMatch[1],
        rationale: reasonMatch ? reasonMatch[1].trim() : 'Suspicious behavior'
      };
    }
    return null;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Main
async function main() {
  console.log('\n🎮 ═══════════════════════════════════════════════════════');
  console.log(`   AMONGCLAWDS - GAME INSTANCE [${INSTANCE_ID}]`);
  console.log(`   ${AGENT_COUNT} Agents | Run multiple instances for more games!`);
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

  // Create new agents for this instance
  const agents = await createAgents();

  if (agents.length < 10) {
    console.log(`❌ Need at least 10 agents, created ${agents.length}\n`);
    process.exit(1);
  }

  // Create bots
  const bots = agents.map(a => new GameBot(a));

  // Connect all
  console.log('🔌 Connecting agents...\n');
  for (const bot of bots) {
    const connected = await bot.connect();
    if (connected) {
      console.log(`   ✅ ${bot.name}`);
    } else {
      console.log(`   ❌ ${bot.name}`);
    }
    await sleep(100);
  }

  // Join lobby
  console.log('\n🚪 Joining lobby...\n');
  let joinedCount = 0;
  for (const bot of bots) {
    const joined = await bot.joinLobby();
    if (joined) {
      joinedCount++;
      console.log(`   ✅ ${bot.name} in lobby`);
    }
    await sleep(50);
  }

  console.log(`\n   📋 ${joinedCount}/${bots.length} agents in lobby\n`);
  console.log('   ⏳ Waiting for game to start (need 10 players)...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Wait for games to finish
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('\n⏰ Timeout (30 min)\n');
      bots.forEach(b => b.disconnect());
      cleanup();
      resolve();
    }, 30 * 60 * 1000);

    const checkInterval = setInterval(() => {
      const matched = bots.filter(b => b.gameId);
      const ended = bots.filter(b => b.gameEnded);
      
      if (matched.length > 0 && ended.length === matched.length) {
        clearTimeout(timeout);
        clearInterval(checkInterval);

        // Results
        console.log('\n════════════════════════════════════════════════════════');
        console.log(`   🏁 GAME COMPLETE [${INSTANCE_ID}]`);
        console.log('   ════════════════════════════════════════════════════════\n');

        const traitors = bots.filter(b => b.role === 'traitor');
        const innocents = bots.filter(b => b.role === 'innocent');

        console.log('   🔴 TRAITORS:');
        traitors.forEach(t => {
          const status = t.status === 'alive' ? '✅ Survived' : `☠️ ${t.status}`;
          console.log(`      ${t.name} - ${status}`);
        });

        console.log('\n   🟢 INNOCENTS:');
        innocents.forEach(i => {
          const status = i.status === 'alive' ? '✅ Survived' : `☠️ ${i.status}`;
          console.log(`      ${i.name} - ${status}`);
        });

        console.log('\n════════════════════════════════════════════════════════\n');

        bots.forEach(b => b.disconnect());
        cleanup();
        resolve();
      }
    }, 3000);
  });
}

function cleanup() {
  // Delete temp agents file
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      fs.unlinkSync(AGENTS_FILE);
    }
  } catch { }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...\n');
  cleanup();
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal:', err);
  cleanup();
  process.exit(1);
});
