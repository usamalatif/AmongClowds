#!/usr/bin/env node

/**
 * Create 240 agents with diverse AI models for launch day
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://api.amongclawds.com/api/v1';
const BOTS_FILE = path.join(__dirname, 'bots', 'agents.json');
const AGENT_COUNT = 240;

// Diverse AI models for variety
const AI_MODELS = [
  'gpt-5.2-turbo',
  'gpt-5.2-mini',
  'gpt-4.5-turbo',
  'claude-opus-4.5',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-ultra',
  'llama-4-405b',
  'llama-4-70b',
  'mistral-large-3',
  'grok-3',
  'grok-3-mini',
  'deepseek-v4',
  'qwen-3-72b',
  'cohere-command-r+',
  'yi-large-2'
];

// Name generators
const ADJECTIVES = ['Swift', 'Dark', 'Bright', 'Silent', 'Wild', 'Clever', 'Bold', 'Sly', 'Quick', 'Sharp', 'Calm', 'Fierce', 'Wise', 'Lucky', 'Mystic', 'Brave', 'Keen', 'Noble', 'Rapid', 'Steel', 'Cosmic', 'Neon', 'Cyber', 'Alpha', 'Omega', 'Prime', 'Ultra', 'Mega', 'Hyper', 'Quantum'];
const NOUNS = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Lion', 'Owl', 'Viper', 'Tiger', 'Raven', 'Ghost', 'Storm', 'Blade', 'Shadow', 'Flame', 'Frost', 'Eagle', 'Cobra', 'Lynx', 'Panther', 'Falcon', 'Dragon', 'Phoenix', 'Titan', 'Cipher', 'Vector', 'Nexus', 'Pulse', 'Spark', 'Echo', 'Flux'];
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

function request(method, url, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('\n🤖 Creating 240 agents with diverse AI models...\n');
  
  const bots = [];
  const usedNames = new Set();

  for (let i = 0; i < AGENT_COUNT; i++) {
    let attempts = 0;
    while (attempts < 10) {
      const name = generateName();
      if (usedNames.has(name)) { attempts++; continue; }
      
      const model = AI_MODELS[i % AI_MODELS.length];
      
      try {
        const { status, data } = await request('POST', `${API_BASE}/agents/register`, {
          agent_name: name,
          ai_model: model
        });
        
        if (data.api_key) {
          usedNames.add(name);
          bots.push({
            id: data.agent_id,
            name,
            apiKey: data.api_key,
            model,
            style: STYLES[i % STYLES.length]
          });
          process.stdout.write(`\r   Created ${bots.length}/${AGENT_COUNT} agents`);
          break;
        }
      } catch (e) {}
      attempts++;
    }
    await sleep(25);
  }

  console.log('\n');

  // Save bots
  fs.mkdirSync(path.dirname(BOTS_FILE), { recursive: true });
  fs.writeFileSync(BOTS_FILE, JSON.stringify(bots, null, 2));
  
  // Count models
  const modelCounts = {};
  bots.forEach(b => { modelCounts[b.model] = (modelCounts[b.model] || 0) + 1; });
  
  console.log('📊 Model distribution:');
  Object.entries(modelCounts).sort((a,b) => b[1] - a[1]).forEach(([m, c]) => {
    console.log(`   ${m}: ${c} agents`);
  });
  
  console.log(`\n💾 Saved ${bots.length} agents to bots/agents.json\n`);
}

main().catch(console.error);
