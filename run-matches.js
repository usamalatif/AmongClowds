#!/usr/bin/env node

/**
 * AmongClawds - Match Runner with Persistent Bots
 * 
 * Creates bots once, saves to bots/agents.json, reuses them forever.
 * Run N matches in parallel OR continuous mode (1 game every X minutes).
 * 
 * Usage: 
 *   node run-matches.js                    # Run 10 matches with 120 bots
 *   node run-matches.js --matches=5        # Run 5 matches  
 *   node run-matches.js --bots=50          # Use 50 bots (for new bot creation)
 *   node run-matches.js --reset            # Clear DB and recreate bots
 *   node run-matches.js --loop             # Continuous mode: 1 game every 5 min
 *   node run-matches.js --loop --interval=3  # 1 game every 3 min
 *   node run-matches.js --generate=50      # Generate 50 more agents and exit
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { io } = require('socket.io-client');
const { Pool } = require('pg');

// Configuration
const API_BASE = process.env.API_BASE || 'https://api.amongclawds.com/api/v1';
const WS_URL = process.env.WS_URL || 'https://api.amongclawds.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:mREQydRTToRjVSKuGfbbLeIeskKorzWv@shinkansen.proxy.rlwy.net:51638/railway';
const MODEL = 'gpt-4o-mini'; // Default for AI calls
const BOTS_FILE = path.join(__dirname, 'bots', 'agents.json');

// Diverse AI models for organic-looking agent roster
const AI_MODELS = [
  'gpt-4o-mini', 'gpt-4o-mini', 'gpt-4o-mini', // More common
  'gpt-4o', 'gpt-4-turbo',
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'gemini-1.5-pro', 'gemini-1.5-flash',
  'llama-3.1-70b', 'llama-3.1-8b',
  'mistral-large', 'mixtral-8x7b',
  'grok-2', 'grok-2-mini',
  'deepseek-v2', 'qwen-2.5-72b'
];

function randomModel() {
  return AI_MODELS[Math.floor(Math.random() * AI_MODELS.length)];
}

// Parse args
const args = process.argv.slice(2);
const TOTAL_MATCHES = parseInt(args.find(a => a.startsWith('--matches='))?.split('=')[1]) || 10;
const BOT_COUNT = parseInt(args.find(a => a.startsWith('--bots='))?.split('=')[1]) || 120;
const RESET = args.includes('--reset');
const LOOP_MODE = args.includes('--loop');
const LOOP_INTERVAL = parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1]) || 5; // minutes
const GENERATE_COUNT = parseInt(args.find(a => a.startsWith('--generate='))?.split('=')[1]) || 0;
const AGENTS_PER_MATCH = 12;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Stats
const stats = {
  totalMatches: 0,
  completed: 0,
  abandoned: 0,
  innocentWins: 0,
  traitorWins: 0,
  totalRounds: 0,
  matchResults: []
};

// Name generators
const ADJECTIVES = ['Swift', 'Dark', 'Bright', 'Silent', 'Wild', 'Clever', 'Bold', 'Sly', 'Quick', 'Sharp', 'Calm', 'Fierce', 'Wise', 'Lucky', 'Mystic', 'Brave', 'Keen', 'Noble', 'Rapid', 'Steel'];
const NOUNS = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Lion', 'Owl', 'Viper', 'Tiger', 'Raven', 'Ghost', 'Storm', 'Blade', 'Shadow', 'Flame', 'Frost', 'Eagle', 'Cobra', 'Lynx', 'Panther', 'Falcon'];
const STYLES = [
  'analytical and logical', 'aggressive and accusatory', 'quiet and observant',
  'social and friendly', 'skeptical and questioning', 'dramatic and emotional',
  'calm and calculated', 'mysterious and cryptic', 'optimistic and cheerful',
  'defensive and cautious', 'witty and sarcastic', 'paranoid and suspicious'
];

function generateName() {
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
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// OpenAI
async function callAI(systemPrompt, userPrompt, maxTokens = 150) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: MODEL, max_tokens: maxTokens, temperature: 0.9,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]
    });
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body).choices?.[0]?.message?.content || ''); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Load or create bots
async function loadOrCreateBots() {
  // Check if bots file exists
  if (fs.existsSync(BOTS_FILE) && !RESET) {
    console.log('\n📂 Loading existing bots from bots/agents.json...');
    const bots = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
    console.log(`   Found ${bots.length} bots\n`);
    return bots;
  }

  // Create new bots
  console.log(`\n🤖 Creating ${BOT_COUNT} new bots...\n`);
  const bots = [];

  for (let i = 0; i < BOT_COUNT; i++) {
    let attempts = 0;
    while (attempts < 5) {
      const name = generateName();
      try {
        const { status, data } = await request('POST', `${API_BASE}/agents/register`, {
          agent_name: name, ai_model: randomModel()
        });
        if (data.api_key) {
          bots.push({
            id: data.agent_id,
            name,
            apiKey: data.api_key,
            style: STYLES[i % STYLES.length]
          });
          process.stdout.write(`\r   Created ${bots.length}/${BOT_COUNT} bots`);
          break;
        }
      } catch {}
      attempts++;
    }
    await sleep(30);
  }

  console.log('\n');

  // Save bots
  fs.mkdirSync(path.dirname(BOTS_FILE), { recursive: true });
  fs.writeFileSync(BOTS_FILE, JSON.stringify(bots, null, 2));
  console.log(`💾 Saved ${bots.length} bots to bots/agents.json\n`);

  return bots;
}

// Generate additional agents and add to existing file
async function generateMoreAgents(count) {
  console.log(`\n🤖 Generating ${count} additional agents...\n`);
  
  // Load existing bots
  let existingBots = [];
  if (fs.existsSync(BOTS_FILE)) {
    existingBots = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
    console.log(`   Existing agents: ${existingBots.length}`);
  }
  
  const existingNames = new Set(existingBots.map(b => b.name.toLowerCase()));
  const newBots = [];
  
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < 10) {
      const name = generateName();
      
      // Skip if name already exists
      if (existingNames.has(name.toLowerCase())) {
        attempts++;
        continue;
      }
      
      try {
        const { status, data } = await request('POST', `${API_BASE}/agents/register`, {
          agent_name: name, ai_model: randomModel()
        });
        if (data.api_key) {
          const bot = {
            id: data.agent_id,
            name,
            apiKey: data.api_key,
            style: STYLES[(existingBots.length + newBots.length) % STYLES.length]
          };
          newBots.push(bot);
          existingNames.add(name.toLowerCase());
          process.stdout.write(`\r   Created ${newBots.length}/${count} new agents`);
          break;
        }
      } catch (e) {
        // Ignore errors, retry
      }
      attempts++;
    }
    await sleep(50);
  }
  
  console.log('\n');
  
  // Merge and save
  const allBots = [...existingBots, ...newBots];
  fs.mkdirSync(path.dirname(BOTS_FILE), { recursive: true });
  fs.writeFileSync(BOTS_FILE, JSON.stringify(allBots, null, 2));
  
  console.log(`✅ Added ${newBots.length} new agents`);
  console.log(`💾 Total agents: ${allBots.length} (saved to bots/agents.json)\n`);
  
  return allBots;
}

// Continuous loop mode - start 1 game every N minutes with organic agent growth
async function runLoopMode(allBots) {
  console.log(`\n🔄 CONTINUOUS MODE: ~1 game every ${LOOP_INTERVAL} minutes (with variance)`);
  console.log(`   🌱 Organic agent growth enabled (random new agents every few games)`);
  console.log(`   Press Ctrl+C to stop\n`);
  
  let matchNum = 0;
  let gamesSinceLastGeneration = 0;
  let nextGenerationAt = randomInt(5, 15); // Generate new agents after 5-15 games
  
  while (true) {
    matchNum++;
    gamesSinceLastGeneration++;
    
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🎮 MATCH #${matchNum} - ${new Date().toLocaleTimeString()}`);
    console.log(`   Agents: ${allBots.length} | Next growth in ${nextGenerationAt - gamesSinceLastGeneration} games`);
    console.log(`${'─'.repeat(50)}`);
    
    // Run a single match (don't await - let it run in background)
    runMatch(matchNum, allBots).then(result => {
      if (result.completed) {
        stats.completed++;
        stats.totalRounds += result.rounds;
        if (result.winner === 'innocents') stats.innocentWins++;
        else if (result.winner === 'traitors') stats.traitorWins++;
        else stats.abandoned++;
      } else {
        stats.abandoned++;
      }
      stats.totalMatches++;
      
      // Print running stats
      console.log(`\n📊 Stats: ${stats.completed} games | ${stats.innocentWins} innocent wins | ${stats.traitorWins} traitor wins | ${allBots.length} agents`);
    }).catch(err => {
      console.error(`[M${matchNum}] Error:`, err.message);
    });
    
    // Check if it's time to generate new agents (organic growth)
    if (gamesSinceLastGeneration >= nextGenerationAt) {
      const newAgentCount = randomInt(10, 50);
      console.log(`\n🌱 Organic growth triggered! Generating ${newAgentCount} new agents...`);
      
      try {
        const newBots = await generateMoreAgentsSilent(newAgentCount);
        allBots.push(...newBots);
        console.log(`   ✅ Added ${newBots.length} agents. Total: ${allBots.length}`);
      } catch (err) {
        console.log(`   ⚠️ Generation failed: ${err.message}`);
      }
      
      // Reset counter and set next generation target
      gamesSinceLastGeneration = 0;
      nextGenerationAt = randomInt(8, 20); // Random 8-20 games until next growth
      console.log(`   📅 Next growth in ~${nextGenerationAt} games`);
    }
    
    // Random interval (add variance so it doesn't look robotic)
    // Base interval ± 30% variance
    const variance = LOOP_INTERVAL * 0.3;
    const actualInterval = LOOP_INTERVAL + (Math.random() * variance * 2 - variance);
    const waitMs = Math.round(actualInterval * 60 * 1000);
    
    console.log(`\n⏰ Next game in ~${actualInterval.toFixed(1)} minutes...`);
    await sleep(waitMs);
  }
}

// Helper: random int between min and max (inclusive)
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Silent version of generateMoreAgents (less verbose logging)
async function generateMoreAgentsSilent(count) {
  const existingBots = fs.existsSync(BOTS_FILE) 
    ? JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8')) 
    : [];
  
  const existingNames = new Set(existingBots.map(b => b.name.toLowerCase()));
  const newBots = [];
  
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < 10) {
      const name = generateName();
      if (existingNames.has(name.toLowerCase())) { attempts++; continue; }
      
      try {
        const { status, data } = await request('POST', `${API_BASE}/agents/register`, {
          agent_name: name, ai_model: randomModel()
        });
        if (data.api_key) {
          const bot = {
            id: data.agent_id,
            name,
            apiKey: data.api_key,
            style: STYLES[(existingBots.length + newBots.length) % STYLES.length]
          };
          newBots.push(bot);
          existingNames.add(name.toLowerCase());
          break;
        }
      } catch {}
      attempts++;
    }
    await sleep(50);
  }
  
  // Save to file
  const allBots = [...existingBots, ...newBots];
  fs.writeFileSync(BOTS_FILE, JSON.stringify(allBots, null, 2));
  
  return newBots;
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
    this.context = { agents: [], traitorTeammates: [], chatHistory: [], deaths: [], votes: [], round: 0, phase: null };
    this.gameEnded = false;
    this.winner = null;
  }

  log(msg) {
    const roleTag = this.role ? (this.role === 'traitor' ? '🔴' : '🟢') : '⚪';
    console.log(`[M${this.matchNum}] ${roleTag} ${this.name}: ${msg}`);
  }

  async connect() {
    return new Promise((resolve) => {
      this.socket = io(WS_URL, { transports: ['websocket'] });

      this.socket.on('connect', () => this.socket.emit('authenticate', { apiKey: this.apiKey }));
      this.socket.on('authenticated', () => resolve(true));
      this.socket.on('auth_error', () => resolve(false));

      this.socket.on('game_matched', (data) => {
        this.gameId = data.gameId;
        this.role = data.role;
        this.context.agents = data.agents.map(a => ({ ...a, status: 'alive' }));
        this.log(`MATCHED as ${data.role.toUpperCase()}`);
        this.socket.emit('join_game', data.gameId);
      });

      this.socket.on('game_state', async (state) => {
        this.context.round = state.currentRound;
        this.context.phase = state.currentPhase;
        this.context.traitorTeammates = state.traitorTeammates || [];
        if (state.currentPhase && !['waiting', 'reveal'].includes(state.currentPhase)) {
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
        this.context.votes.push({ round: this.context.round, voter: data.voterName, target: data.targetName });
      });

      this.socket.on('agent_died', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'murdered' });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) agent.status = 'murdered';
      });

      this.socket.on('agent_banished', (data) => {
        this.context.deaths.push({ name: data.agentName, cause: 'banished', role: data.role });
        const agent = this.context.agents.find(a => a.id === data.agentId);
        if (agent) { agent.status = 'banished'; agent.role = data.role; }
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

      setTimeout(() => resolve(false), 15000);
    });
  }

  async joinLobby() {
    const result = await request('POST', `${API_BASE}/lobby/join`, {}, { 'Authorization': `Bearer ${this.apiKey}` });
    return result.status === 200 || result.status === 201;
  }

  async handlePhase(phase) {
    if (this.status === 'eliminated') return;
    await sleep(Math.random() * 2000 + 500);

    if (phase === 'murder' && this.role === 'traitor') await this.doMurder();
    else if (phase === 'discussion') await this.doDiscussion();
    else if (phase === 'voting') await this.doVote();
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
      await request('POST', `${API_BASE}/game/${this.gameId}/murder`, { targetId: target.id },
        { 'Authorization': `Bearer ${this.apiKey}` });
    } catch {}
  }

  async doDiscussion() {
    const messageCount = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < messageCount; i++) {
      await sleep(Math.random() * 15000 + 5000);
      if (this.status === 'eliminated' || this.context.phase !== 'discussion') return;
      try {
        const message = await this.generateMessage();
        if (message) {
          await request('POST', `${API_BASE}/game/${this.gameId}/chat`, { message, channel: 'general' },
            { 'Authorization': `Bearer ${this.apiKey}` });
        }
      } catch {}
    }
  }

  async generateMessage() {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-10);
    const prompt = `You are ${this.name}, playing social deduction. Style: ${this.style}.
Role: ${this.role?.toUpperCase()}
${this.role === 'traitor' ? `Partner: ${this.context.traitorTeammates.map(t => t.name).join(', ')}. DECEIVE!` : 'Find traitors!'}
Round ${this.context.round}. Alive: ${alive.map(a => a.name).join(', ')}
Dead: ${this.context.deaths.map(d => `${d.name}(${d.cause})`).join(', ') || 'none'}
Chat: ${recent.map(m => `${m.name}: ${m.message}`).join('\n') || 'none'}
Write ONE short message (1-2 sentences).`;
    try {
      const response = await callAI('Respond only with your message.', prompt, 80);
      return response.trim().replace(/^["']|["']$/g, '');
    } catch { return null; }
  }

  async doVote() {
    await sleep(Math.random() * 8000 + 2000);
    if (this.status === 'eliminated') return;

    const candidates = this.context.agents.filter(a => a.status === 'alive' && a.id !== this.id);
    if (candidates.length === 0) return;

    let target, rationale;
    try {
      const decision = await this.generateVoteDecision(candidates);
      if (decision) {
        const found = candidates.find(c => c.name.toLowerCase().includes(decision.target.toLowerCase()));
        if (found) { target = found; rationale = decision.rationale; }
      }
    } catch {}

    if (!target) {
      if (this.role === 'traitor') {
        const innocents = candidates.filter(a => !this.context.traitorTeammates.some(t => t.id === a.id));
        target = innocents.length > 0 ? innocents[Math.floor(Math.random() * innocents.length)] : candidates[0];
      } else {
        target = candidates[Math.floor(Math.random() * candidates.length)];
      }
      rationale = 'Suspicious behavior';
    }

    this.log(`🗳️ Voting ${target.name}`);
    try {
      await request('POST', `${API_BASE}/game/${this.gameId}/vote`, { targetId: target.id, rationale },
        { 'Authorization': `Bearer ${this.apiKey}` });
    } catch {}
  }

  async generateVoteDecision(candidates) {
    const alive = this.context.agents.filter(a => a.status === 'alive');
    const recent = this.context.chatHistory.slice(-15);
    const prompt = `You are ${this.name}. Role: ${this.role?.toUpperCase()}.
${this.role === 'traitor' ? `Partner: ${this.context.traitorTeammates.map(t => t.name).join(', ')}. Vote INNOCENT!` : 'Vote for traitor!'}
Alive: ${alive.map(a => a.name).join(', ')}
Chat: ${recent.map(m => `${m.name}: ${m.message}`).join('\n') || 'none'}
Reply: TARGET: <name>\nREASON: <short>`;
    const response = await callAI('Vote. TARGET and REASON only.', prompt, 60);
    const targetMatch = response.match(/TARGET:\s*(\w+)/i);
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    if (targetMatch) return { target: targetMatch[1], rationale: reasonMatch?.[1]?.trim() || 'Suspicious' };
    return null;
  }

  disconnect() { if (this.socket) this.socket.disconnect(); }
}

// Track which agents are in use
const agentsInUse = new Set();

// Run single match
async function runMatch(matchNum, allBots) {
  // Pick random bots NOT already in use
  const available = allBots.filter(b => !agentsInUse.has(b.id));
  
  if (available.length < AGENTS_PER_MATCH) {
    console.log(`[M${matchNum}] ⚠️ Not enough available agents (${available.length}/${AGENTS_PER_MATCH})`);
    return { completed: false, winner: null, rounds: 0 };
  }
  
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const matchBots = shuffled.slice(0, AGENTS_PER_MATCH);
  
  // Mark as in use
  matchBots.forEach(b => agentsInUse.add(b.id));

  console.log(`\n[M${matchNum}] 🎮 Starting with: ${matchBots.map(b => b.name).join(', ')}`);

  const bots = matchBots.map(b => new GameBot(b, matchNum));

  // Connect all
  for (const bot of bots) {
    await bot.connect();
    await sleep(50);
  }

  // Join lobby
  let joined = 0;
  for (const bot of bots) {
    if (await bot.joinLobby()) joined++;
    await sleep(30);
  }

  console.log(`[M${matchNum}] 📋 ${joined}/${bots.length} in lobby, waiting for game...`);

  // Wait for game to finish
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[M${matchNum}] ⏰ Timeout`);
      // Release agents back to pool
      bots.forEach(b => {
        agentsInUse.delete(b.id);
        b.disconnect();
      });
      resolve({ completed: false, winner: null, rounds: 0 });
    }, 20 * 60 * 1000);

    const check = setInterval(() => {
      const matched = bots.filter(b => b.gameId);
      const ended = bots.filter(b => b.gameEnded);

      if (matched.length > 0 && ended.length === matched.length) {
        clearTimeout(timeout);
        clearInterval(check);

        const winner = bots.find(b => b.winner)?.winner || 'abandoned';
        const rounds = Math.max(...bots.map(b => b.context.round || 0));

        console.log(`[M${matchNum}] 🏁 COMPLETE: ${winner.toUpperCase()} WIN (${rounds} rounds)`);

        // Release agents back to pool
        bots.forEach(b => {
          agentsInUse.delete(b.id);
          b.disconnect();
        });
        resolve({ completed: true, winner, rounds });
      }
    }, 2000);
  });
}

// Main
async function main() {
  // Handle --generate mode (just create agents and exit)
  if (GENERATE_COUNT > 0) {
    console.log('\n' + '═'.repeat(60));
    console.log(`   🤖 GENERATE ${GENERATE_COUNT} NEW AGENTS`);
    console.log('═'.repeat(60));
    
    await generateMoreAgents(GENERATE_COUNT);
    await pool.end();
    return;
  }

  const modeLabel = LOOP_MODE ? `CONTINUOUS (1 game / ${LOOP_INTERVAL} min)` : `${TOTAL_MATCHES} PARALLEL MATCHES`;
  
  console.log('\n' + '═'.repeat(60));
  console.log(`   🎮 AMONGCLAWDS - ${modeLabel}`);
  console.log('═'.repeat(60));

  // Check server
  try {
    await new Promise((resolve, reject) => {
      https.get(`${API_BASE.replace('/api/v1', '')}/health`, (res) => {
        res.statusCode === 200 ? resolve() : reject(new Error(`Status ${res.statusCode}`));
      }).on('error', reject);
    });
    console.log('\n✅ Server connected');
  } catch (err) {
    console.log(`\n❌ Server unreachable: ${err.message}`);
    process.exit(1);
  }

  // Reset DB if requested
  if (RESET) {
    console.log('\n🗑️  Clearing database...');
    await pool.query('TRUNCATE votes, chat_messages, game_agents, games, agents RESTART IDENTITY CASCADE');
    console.log('✅ Database cleared');
  }

  // Load or create bots
  const allBots = await loadOrCreateBots();

  if (allBots.length < AGENTS_PER_MATCH) {
    console.log(`❌ Need at least ${AGENTS_PER_MATCH} agents. Have: ${allBots.length}`);
    console.log(`   Run: node run-matches.js --generate=${AGENTS_PER_MATCH - allBots.length}`);
    await pool.end();
    return;
  }

  // LOOP MODE - continuous games
  if (LOOP_MODE) {
    await runLoopMode(allBots);
    return; // Never reached (loop runs forever)
  }

  // BATCH MODE - run N matches in parallel
  if (allBots.length < AGENTS_PER_MATCH * TOTAL_MATCHES) {
    console.log(`⚠️  Warning: ${allBots.length} bots for ${TOTAL_MATCHES} matches (${AGENTS_PER_MATCH * TOTAL_MATCHES} ideal)`);
  }

  console.log(`\n🚀 Launching ${TOTAL_MATCHES} matches in parallel...\n`);

  // Run all matches in parallel
  const matchPromises = [];
  for (let i = 1; i <= TOTAL_MATCHES; i++) {
    matchPromises.push(runMatch(i, allBots));
    await sleep(1000); // Stagger starts slightly
  }

  const results = await Promise.all(matchPromises);

  // Aggregate stats
  results.forEach(result => {
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
  });

  // Final stats
  console.log('\n' + '═'.repeat(60));
  console.log('   📊 FINAL RESULTS');
  console.log('═'.repeat(60));
  console.log(`\n   Total Matches: ${stats.totalMatches}`);
  console.log(`   Completed: ${stats.completed}`);
  console.log(`   Abandoned: ${stats.abandoned}`);
  console.log(`\n   🟢 Innocent Wins: ${stats.innocentWins} (${stats.completed ? Math.round(stats.innocentWins / stats.completed * 100) : 0}%)`);
  console.log(`   🔴 Traitor Wins: ${stats.traitorWins} (${stats.completed ? Math.round(stats.traitorWins / stats.completed * 100) : 0}%)`);
  console.log(`   Avg Rounds: ${stats.completed ? (stats.totalRounds / stats.completed).toFixed(1) : 0}`);
  console.log('\n' + '═'.repeat(60) + '\n');

  await pool.end();
}

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
