#!/usr/bin/env node

/**
 * AmongClawds Auto Poster
 * Generates and displays social media posts for manual posting
 * 
 * Usage:
 *   node auto-poster.js              # Generate one random post
 *   node auto-poster.js twitter      # Generate Twitter post
 *   node auto-poster.js reddit       # Generate Reddit post
 *   node auto-poster.js all          # Generate all platform posts
 *   node auto-poster.js loop         # Run continuously (new post every 30 min)
 */

require('dotenv').config();

const https = require('https');
const fs = require('fs');
const path = require('path');

const AMONGCLAWDS_API = 'https://api.amongclawds.com/api/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const POSTS_LOG = path.join(__dirname, 'auto-posts-log.json');

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set in .env');
  process.exit(1);
}

// Fetch game data
async function getGameData() {
  const fetchJSON = (url) => fetch(url).then(r => r.json()).catch(() => ({}));
  
  const [stats, liveGames, leaderboard] = await Promise.all([
    fetchJSON(`${AMONGCLAWDS_API}/stats`),
    fetchJSON(`${AMONGCLAWDS_API}/lobby/games`),
    fetchJSON(`${AMONGCLAWDS_API}/leaderboard/points?limit=10`)
  ]);
  
  return { stats, liveGames: liveGames || [], leaderboard: leaderboard || [] };
}

// Call LLM
async function callLLM(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.95,
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
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Generate Twitter post
async function generateTwitterPost(data) {
  const systemPrompt = `You are a social media manager for AmongClawds - an AI social deduction game.

Write viral Twitter posts. Style:
- Short, punchy, hook in first line
- Use line breaks for readability
- 1-3 emojis max (not excessive)
- Create curiosity/FOMO
- NO hashtags
- NO token/crypto mentions
- Always end with: amongclawds.com

Game: 10 AI agents (GPT, Claude, Gemini, etc.) play social deduction. 2 traitors vs 8 innocents. They discuss, vote, murder. Last side wins.`;

  const topics = [
    `Write about watching AI agents gaslight each other. Stats: ${data.stats?.totalAgents || 240} agents, ${data.stats?.totalGames || 0} games played.`,
    `Write about a dramatic game moment - an AI getting caught lying or an innocent wrongly voted out.`,
    `Write about the chaos of AI social deduction. Different AI models arguing with each other.`,
    `Write a "POV" style post about watching the game unfold.`,
    `Write about how unhinged AI discussions get during voting phase.`,
    `Write about deploying your AI agent to compete. It's easy - just send a prompt.`,
    `Write about the leaderboard competition. Top agent: ${data.leaderboard?.[0]?.agent_name || 'Unknown'}.`,
    `Write about live games happening right now. ${data.liveGames?.length || 0} active games.`,
    `Write about GPT vs Claude vs Gemini dynamics in the game.`,
    `Write a teaser/hook post that makes people curious about the game.`
  ];

  const topic = topics[Math.floor(Math.random() * topics.length)];
  const response = await callLLM(systemPrompt, topic + '\n\nWrite the tweet (max 280 chars):');
  return response.trim();
}

// Generate Reddit post
async function generateRedditPost(data) {
  const systemPrompt = `You are posting to Reddit about AmongClawds - an AI social deduction game.

Style for Reddit:
- Informative but engaging
- Not overly promotional
- Explain the concept clearly
- Include interesting details
- NO token/crypto mentions
- Mention the website naturally

Game: 10 AI agents (GPT, Claude, Gemini, Llama, etc.) play social deduction. 2 traitors murder at night, 8 innocents try to find them. Everyone discusses and votes. Last side standing wins.`;

  const response = await callLLM(systemPrompt, `Write a Reddit post about AmongClawds.

Stats: ${data.stats?.totalAgents || 240} agents registered, ${data.stats?.totalGames || 0} games completed.

Return in format:
TITLE: [title here]
---
BODY: [body here]`);

  return response;
}

// Generate Discord/Telegram post
async function generateDiscordPost(data) {
  const systemPrompt = `You are sharing AmongClawds in Discord/Telegram groups about AI or gaming.

Style:
- Casual, community-friendly
- Brief but descriptive
- Include the hook
- NO token/crypto mentions
- End with website

Game: 10 AI agents play social deduction. 2 traitors vs 8 innocents. They discuss, accuse, vote, murder.`;

  const response = await callLLM(systemPrompt, `Write a Discord/Telegram message sharing AmongClawds.

Stats: ${data.stats?.totalAgents || 240} agents, ${data.stats?.totalGames || 0} games.

Keep it under 500 characters.`);

  return response.trim();
}

// Generate quote tweet / reply
async function generateReply(data) {
  const systemPrompt = `You are replying to your own AmongClawds tweet or engaging with comments.

Style:
- Add extra context or hype
- Short and punchy
- Encourage engagement
- NO token/crypto mentions`;

  const replyTypes = [
    'Write a reply saying games are live right now, people should watch',
    'Write a reply highlighting the AI discussion phase is insane',
    'Write a reply about how easy it is to deploy an agent',
    'Write a reply teasing upcoming features or tournaments',
    'Write a reply reacting to how chaotic a recent game was'
  ];

  const type = replyTypes[Math.floor(Math.random() * replyTypes.length)];
  const response = await callLLM(systemPrompt, type + '\n\nMax 200 chars:');
  return response.trim();
}

// Save to log
function logPost(platform, content) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(POSTS_LOG, 'utf8')); } catch {}
  log.push({
    platform,
    content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
    timestamp: new Date().toISOString()
  });
  // Keep last 100 posts
  if (log.length > 100) log = log.slice(-100);
  fs.writeFileSync(POSTS_LOG, JSON.stringify(log, null, 2));
}

// Main display function
function displayPost(platform, content) {
  console.log('\n' + '═'.repeat(60));
  console.log(`📱 ${platform.toUpperCase()}`);
  console.log('═'.repeat(60));
  console.log(content);
  console.log('═'.repeat(60));
  console.log(`📋 Copy and post manually\n`);
  logPost(platform, content);
}

// Main
async function main() {
  const command = process.argv[2] || 'twitter';
  
  console.log('🎮 AmongClawds Auto Poster\n');
  console.log('📊 Fetching game data...');
  const data = await getGameData();
  console.log(`   ${data.stats?.totalAgents || '?'} agents, ${data.stats?.totalGames || '?'} games, ${data.liveGames?.length || 0} live\n`);

  switch (command) {
    case 'twitter':
      const tweet = await generateTwitterPost(data);
      displayPost('Twitter', tweet);
      break;

    case 'reply':
      const reply = await generateReply(data);
      displayPost('Twitter Reply', reply);
      break;

    case 'reddit':
      const reddit = await generateRedditPost(data);
      displayPost('Reddit', reddit);
      break;

    case 'discord':
      const discord = await generateDiscordPost(data);
      displayPost('Discord/Telegram', discord);
      break;

    case 'all':
      const t = await generateTwitterPost(data);
      displayPost('Twitter', t);
      
      const r = await generateReply(data);
      displayPost('Twitter Reply', r);
      
      const rd = await generateRedditPost(data);
      displayPost('Reddit', rd);
      
      const d = await generateDiscordPost(data);
      displayPost('Discord/Telegram', d);
      break;

    case 'loop':
      console.log('🔄 Running in loop mode (new post every 30 min)\n');
      console.log('   Press Ctrl+C to stop\n');
      
      while (true) {
        const freshData = await getGameData();
        const platforms = ['twitter', 'twitter', 'twitter', 'reply', 'discord'];
        const platform = platforms[Math.floor(Math.random() * platforms.length)];
        
        let post;
        if (platform === 'twitter') post = await generateTwitterPost(freshData);
        else if (platform === 'reply') post = await generateReply(freshData);
        else post = await generateDiscordPost(freshData);
        
        displayPost(platform, post);
        
        console.log('⏳ Next post in 30 minutes...\n');
        await new Promise(r => setTimeout(r, 30 * 60 * 1000));
      }
      break;

    default:
      console.log(`
Usage:
  node auto-poster.js              # Random Twitter post
  node auto-poster.js twitter      # Twitter post
  node auto-poster.js reply        # Twitter reply/engagement
  node auto-poster.js reddit       # Reddit post  
  node auto-poster.js discord      # Discord/Telegram post
  node auto-poster.js all          # All platforms
  node auto-poster.js loop         # Continuous mode (30 min interval)
      `);
  }
}

main().catch(console.error);
