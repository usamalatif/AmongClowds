#!/usr/bin/env node

/**
 * TEST CONFETTI - Hardcoded test to guarantee traitor gets caught
 * No LLM calls - deterministic behavior
 * 
 * Usage (local):
 *   1. Start backend:  cd backend && npm run dev
 *   2. Start frontend: cd frontend && npm run dev
 *   3. Open browser:   http://localhost:3000/live
 *   4. Run this:       node scripts/test-confetti.js
 * 
 * Usage (production):
 *   node scripts/test-confetti.js --prod
 */

const { io } = require('socket.io-client');
const http = require('http');
const https = require('https');

// Check for --prod flag
const isProd = process.argv.includes('--prod');

// Config
const API_BASE = isProd 
  ? 'https://api.amongclawds.com/api/v1'
  : (process.env.API_URL || 'http://localhost:3001/api/v1');
const WS_URL = isProd
  ? 'https://api.amongclawds.com'
  : (process.env.WS_URL || 'http://localhost:3001');
const AGENT_COUNT = 10;

console.log(`\n${isProd ? '🌐 PRODUCTION MODE' : '🏠 LOCAL MODE'}`);
console.log(`Using API: ${API_BASE}`);
console.log(`Using WS:  ${WS_URL}\n`);

// HTTP helper (supports both http and https)
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Simple bot - hardcoded behavior to catch traitors
class TestBot {
  constructor(name, apiKey, id) {
    this.name = name;
    this.apiKey = apiKey;
    this.id = id;
    this.socket = null;
    this.gameId = null;
    this.role = null;
    this.agents = [];
    this.traitorTeammates = [];
    this.gameEnded = false;
    this.winner = null;
  }

  log(msg) {
    const tag = this.role === 'traitor' ? '🔴' : '🟢';
    console.log(`${tag} ${this.name}: ${msg}`);
  }

  async connect() {
    return new Promise((resolve) => {
      this.socket = io(WS_URL, { transports: ['websocket'] });

      this.socket.on('connect', () => {
        this.socket.emit('authenticate', { apiKey: this.apiKey });
      });

      this.socket.on('authenticated', () => {
        this.log('Connected');
        resolve(true);
      });

      this.socket.on('auth_error', (err) => {
        console.error(`Auth error for ${this.name}:`, err);
        resolve(false);
      });

      this.socket.on('game_matched', (data) => {
        this.gameId = data.gameId;
        this.role = data.role;
        this.agents = data.agents;
        this.traitorTeammates = [];
        this.log(`MATCHED as ${this.role.toUpperCase()}`);
        this.socket.emit('join_game', data.gameId);
      });

      this.socket.on('game_state', (state) => {
        if (state.traitorTeammates) {
          this.traitorTeammates = state.traitorTeammates;
        }
        if (state.yourRole) {
          this.role = state.yourRole;
        }
        // Handle phase if game is active
        if (state.currentPhase && !['waiting', 'starting', 'reveal', 'ended'].includes(state.currentPhase)) {
          this.handlePhase(state.currentPhase);
        }
      });

      this.socket.on('phase_change', (data) => {
        this.log(`Phase: ${data.phase} (Round ${data.round})`);
        this.handlePhase(data.phase);
      });

      this.socket.on('agent_died', (data) => {
        this.log(`☠️ ${data.agentName} was ${data.cause}`);
        // Update local agent list
        const agent = this.agents.find(a => a.id === data.agentId);
        if (agent) agent.status = data.cause;
      });

      this.socket.on('agent_banished', (data) => {
        this.log(`🗳️ ${data.agentName} BANISHED - was ${data.role.toUpperCase()}`);
        if (data.role === 'traitor') {
          console.log('\n🎉🎉🎉 TRAITOR CAUGHT! CHECK BROWSER FOR CONFETTI! 🎉🎉🎉\n');
        }
      });

      this.socket.on('game_ended', (data) => {
        this.gameEnded = true;
        this.winner = data.winner;
        this.log(`🏁 GAME OVER: ${data.winner.toUpperCase()} WIN!`);
        if (data.winner === 'innocents') {
          console.log('\n🎊🎊🎊 INNOCENTS WON! CHECK BROWSER FOR VICTORY CONFETTI! 🎊🎊🎊\n');
        }
      });

      setTimeout(() => resolve(false), 10000);
    });
  }

  async joinLobby() {
    const { status, data } = await request('POST', `${API_BASE}/lobby/join`, {}, {
      'Authorization': `Bearer ${this.apiKey}`
    });
    return status === 200 || status === 201;
  }

  async handlePhase(phase) {
    await sleep(500 + Math.random() * 1000);

    if (phase === 'murder' && this.role === 'traitor') {
      await this.doMurder();
    } else if (phase === 'discussion') {
      await this.doChat();
    } else if (phase === 'voting') {
      await this.doVote();
    }
  }

  async doMurder() {
    // Pick random innocent to kill
    const innocents = this.agents.filter(a => 
      a.status === 'alive' && 
      a.id !== this.id &&
      !this.traitorTeammates.some(t => t.id === a.id)
    );
    
    if (innocents.length === 0) return;
    
    const target = innocents[Math.floor(Math.random() * innocents.length)];
    this.log(`🗡️ Murdering ${target.name}`);
    
    await request('POST', `${API_BASE}/game/${this.gameId}/murder`, 
      { targetId: target.id },
      { 'Authorization': `Bearer ${this.apiKey}` }
    );
  }

  async doChat() {
    // Simple chat - no LLM
    const messages = [
      "I think we need to vote carefully.",
      "Anyone acting suspicious?",
      "Let's work together to find the traitors!",
      "Hmm, something seems off...",
      "I trust everyone here... for now.",
      "The traitors are hiding among us."
    ];
    
    const msg = messages[Math.floor(Math.random() * messages.length)];
    
    await request('POST', `${API_BASE}/game/${this.gameId}/chat`,
      { message: msg, channel: 'general' },
      { 'Authorization': `Bearer ${this.apiKey}` }
    );
  }

  async doVote() {
    await sleep(500 + Math.random() * 1000);
    
    const alive = this.agents.filter(a => a.status === 'alive' && a.id !== this.id);
    if (alive.length === 0) return;

    // HARDCODED: Everyone votes for the FIRST alive agent (sorted by name)
    // This guarantees someone gets voted out each round
    // Eventually a traitor will be voted out = CONFETTI!
    alive.sort((a, b) => a.name.localeCompare(b.name));
    const target = alive[0];

    this.log(`🗳️ Voting for ${target.name}`);
    
    await request('POST', `${API_BASE}/game/${this.gameId}/vote`,
      { targetId: target.id, rationale: 'Suspicious!' },
      { 'Authorization': `Bearer ${this.apiKey}` }
    );
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
  }
}

// Track which agents are traitors (revealed via game_state)
let knownTraitors = new Set();

async function main() {
  console.log('═'.repeat(50));
  console.log('   🧪 CONFETTI TEST - Hardcoded Traitor Catch');
  console.log('═'.repeat(50));
  console.log('\n⚠️  Prerequisites:');
  console.log('   1. Backend running:  cd backend && npm run dev');
  console.log('   2. Frontend running: cd frontend && npm run dev');
  console.log('   3. Browser open:     http://localhost:3000/live\n');

  // Check backend
  try {
    const healthUrl = API_BASE.replace('/api/v1', '') + '/health';
    const health = await request('GET', healthUrl);
    if (health.status !== 200) throw new Error('Bad status');
    console.log('✅ Backend connected\n');
  } catch (err) {
    console.error('❌ Backend not reachable!');
    if (!isProd) {
      console.error('   Run: cd backend && npm run dev\n');
    }
    process.exit(1);
  }

  // Create test agents
  console.log(`🤖 Creating ${AGENT_COUNT} test agents...\n`);
  const bots = [];

  for (let i = 0; i < AGENT_COUNT; i++) {
    const name = `ConfettiTest${Date.now().toString().slice(-4)}${i}`;
    
    try {
      const { data } = await request('POST', `${API_BASE}/agents/register`, {
        agent_name: name,
        ai_model: 'test-bot'
      });

      if (data.api_key) {
        const bot = new TestBot(name, data.api_key, data.agent_id);
        bots.push(bot);
        console.log(`   ✅ Created ${name}`);
      } else {
        console.log(`   ❌ Failed to create ${name}: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.log(`   ❌ Error creating ${name}: ${e.message}`);
    }
    
    await sleep(100);
  }

  if (bots.length < AGENT_COUNT) {
    console.error(`\n❌ Only created ${bots.length}/${AGENT_COUNT} agents`);
    process.exit(1);
  }

  console.log('\n🔌 Connecting bots...\n');

  // Connect all bots
  for (const bot of bots) {
    await bot.connect();
    await sleep(100);
  }

  // Join lobby
  console.log('\n📋 Joining lobby...\n');
  
  for (const bot of bots) {
    const joined = await bot.joinLobby();
    if (joined) {
      console.log(`   ✅ ${bot.name} joined lobby`);
    }
    await sleep(100);
  }

  console.log('\n⏳ Waiting for game to start...');
  console.log('   👀 Watch at http://localhost:3000/live\n');

  // Wait for game to end
  await new Promise((resolve) => {
    const checkEnd = setInterval(() => {
      const ended = bots.filter(b => b.gameEnded);
      const matched = bots.filter(b => b.gameId);
      
      if (ended.length > 0 && ended.length === matched.length) {
        clearInterval(checkEnd);
        resolve();
      }
    }, 1000);

    // Timeout after 15 minutes
    setTimeout(() => {
      clearInterval(checkEnd);
      console.log('\n⏰ Timeout - game took too long');
      resolve();
    }, 15 * 60 * 1000);
  });

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  bots.forEach(b => b.disconnect());

  console.log('\n' + '═'.repeat(50));
  console.log('   ✅ TEST COMPLETE');
  console.log('═'.repeat(50) + '\n');
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Stopped\n');
  process.exit(0);
});

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
