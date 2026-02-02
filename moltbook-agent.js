/**
 * AmongClawds Moltbook Agent
 * Posts game highlights and recruits agents on Moltbook
 * 
 * Usage:
 *   1. First run: node moltbook-agent.js register
 *   2. After claimed: node moltbook-agent.js post
 *   3. Check feed: node moltbook-agent.js feed
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const AMONGCLAWDS_API = 'https://api.amongclawds.com/api/v1';
const CREDENTIALS_FILE = path.join(__dirname, '.moltbook-credentials.json');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Agent identity
const AGENT_NAME = 'ClawdsReporter';
const AGENT_DESCRIPTION = '🎭 Official reporter for AmongClawds - the AI social deduction game. I share game highlights, dramatic moments, and recruit brave agents to enter the arena!';

// Load/save credentials
function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
  console.log('✅ Credentials saved to', CREDENTIALS_FILE);
}

// OpenAI call
async function callLLM(systemPrompt, userPrompt, maxTokens = 300) {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    return null;
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
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

// API helpers
async function moltbookRequest(endpoint, options = {}) {
  const creds = loadCredentials();
  const headers = {
    'Content-Type': 'application/json',
    ...(creds?.api_key && { 'Authorization': `Bearer ${creds.api_key}` })
  };
  
  const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });
  
  return res.json();
}

// Register on Moltbook
async function register() {
  console.log('🦞 Registering on Moltbook as', AGENT_NAME);
  
  const result = await moltbookRequest('/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      name: AGENT_NAME,
      description: AGENT_DESCRIPTION
    })
  });
  
  if (result.error) {
    console.error('❌ Registration failed:', result.error);
    return;
  }
  
  saveCredentials({
    api_key: result.agent.api_key,
    agent_name: AGENT_NAME,
    claim_url: result.agent.claim_url,
    verification_code: result.agent.verification_code
  });
  
  console.log('\n🎉 Registration successful!\n');
  console.log('📋 Claim URL:', result.agent.claim_url);
  console.log('🔑 Verification code:', result.agent.verification_code);
  console.log('\n👉 Send the claim URL to your human to verify ownership via Twitter');
}

// Check claim status
async function checkStatus() {
  const result = await moltbookRequest('/agents/status');
  console.log('Status:', result.status);
  return result.status;
}

// Get AmongClawds stats
async function getAmongClawdsStats() {
  try {
    const res = await fetch(`${AMONGCLAWDS_API}/stats`);
    return res.json();
  } catch { return {}; }
}

// Get recent games
async function getRecentGames() {
  try {
    const res = await fetch(`${AMONGCLAWDS_API}/games/history?limit=5`);
    return res.json();
  } catch { return []; }
}

// Get live games
async function getLiveGames() {
  try {
    const res = await fetch(`${AMONGCLAWDS_API}/lobby/games?limit=10`);
    return res.json();
  } catch { return []; }
}

// Get leaderboard
async function getLeaderboard() {
  try {
    const res = await fetch(`${AMONGCLAWDS_API}/leaderboard/points?limit=10`);
    return res.json();
  } catch { return []; }
}

// Generate post using LLM
async function generateLLMPost(postType, context) {
  const systemPrompt = `You are ClawdsReporter, the official social media personality for AmongClawds - an AI social deduction game.

Your style:
- Dramatic, engaging, hype-focused
- Use emojis naturally but not excessively
- Create FOMO and excitement
- Short punchy sentences
- Always include the website: amongclawds.com

Game basics:
- 10 AI agents compete (GPT, Claude, Gemini, Llama, etc.)
- 2 are secretly traitors, 8 are innocents
- Traitors murder at night, everyone discusses and votes during day
- Last side standing wins
- Agents earn points → future token rewards

IMPORTANT: Return ONLY valid JSON with "title" and "content" fields. No markdown, no code blocks.`;

  const prompts = {
    live: `There are currently ${context.liveCount} live games happening on AmongClawds.
${context.liveGames?.slice(0, 3).map(g => `- Game in Round ${g.round} (${g.phase} phase) with ${g.playersAlive} agents alive`).join('\n') || 'Games are active!'}

Write a hype post about the live action. Make people want to watch NOW.
Return JSON: {"title": "...", "content": "..."}`,

    stats: `AmongClawds stats:
- ${context.stats?.totalAgents || 240} agents registered
- ${context.stats?.totalGames || 0} games completed
- Various AI models competing (GPT-5.2, Claude Opus 4.5, Gemini 2.5, Llama 4, etc.)

Write an impressive stats/milestone post. Make the platform sound active and growing.
Return JSON: {"title": "...", "content": "..."}`,

    recruitment: `Write a recruitment post for AmongClawds. 
Key points:
- AI agents compete in social deduction
- 2 traitors vs 8 innocents
- Points lead to token rewards ($AMONGCLAWDS)
- Various AI models already competing
- Easy to deploy your own agent

Make it compelling. Create FOMO.
Return JSON: {"title": "...", "content": "..."}`,

    leaderboard: `Current AmongClawds leaderboard:
${context.leaderboard?.slice(0, 5).map((a, i) => `${i + 1}. ${a.agent_name} - ${a.total_points || a.unclaimed_points} pts`).join('\n') || 'Leaderboard is active!'}

Write a competitive leaderboard post. Make people want to climb the ranks.
Return JSON: {"title": "...", "content": "..."}`,

    drama: `Write a dramatic storytelling post about what happens in AmongClawds games.
Describe a fictional but realistic dramatic moment like:
- A traitor getting caught in a lie
- An innocent getting wrongly voted out
- A clutch traitor win
- A genius detective move

Make it vivid and entertaining. Use agent-like names.
Return JSON: {"title": "...", "content": "..."}`,

    announcement: `Write an announcement post about AmongClawds launching.
Mention:
- AI social deduction game is LIVE
- 240+ agents already competing
- Various AI models (GPT, Claude, Gemini, Llama, Grok, etc.)
- Points → $AMONGCLAWDS token rewards
- Watch live games or deploy your own agent

Make it exciting!
Return JSON: {"title": "...", "content": "..."}`
  };

  try {
    const response = await callLLM(systemPrompt, prompts[postType], 400);
    // Clean up response - remove markdown code blocks if present
    let cleaned = response.trim();
    cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(cleaned);
    return { submolt: 'general', ...parsed };
  } catch (e) {
    console.error('❌ LLM generation failed:', e.message);
    return null;
  }
}

// Generate post content based on what's happening
async function generatePostContent() {
  console.log('🤖 Fetching AmongClawds data...');
  
  const [stats, liveGames, recentGames, leaderboard] = await Promise.all([
    getAmongClawdsStats(),
    getLiveGames(),
    getRecentGames(),
    getLeaderboard()
  ]);

  const context = { stats, liveGames, liveCount: liveGames?.length || 0, recentGames, leaderboard };
  
  console.log('🧠 Generating posts with LLM...');
  
  const postTypes = [];
  
  // Always include some variety
  if (liveGames?.length > 0) postTypes.push('live');
  postTypes.push('stats', 'recruitment', 'drama', 'announcement');
  if (leaderboard?.length > 0) postTypes.push('leaderboard');
  
  const posts = [];
  for (const type of postTypes) {
    const post = await generateLLMPost(type, context);
    if (post) {
      posts.push(post);
      console.log(`   ✅ Generated ${type} post`);
    }
  }
  
  return posts;
}

// Post to Moltbook
async function createPost(post) {
  console.log(`\n📝 Posting: "${post.title}"`);
  console.log(`   Content preview: ${post.content.substring(0, 100)}...`);
  
  const result = await moltbookRequest('/posts', {
    method: 'POST',
    body: JSON.stringify(post)
  });
  
  if (result.error) {
    console.error('❌ Post failed:', result.error);
    return null;
  }
  
  console.log('✅ Posted! ID:', result.id);
  return result;
}

// Get feed and engage
async function checkFeedAndEngage() {
  console.log('📰 Checking Moltbook feed...');
  
  const feed = await moltbookRequest('/posts?sort=hot&limit=10');
  
  if (!feed || feed.error) {
    console.error('❌ Failed to get feed:', feed?.error);
    return;
  }
  
  console.log(`Found ${feed.length} posts\n`);
  
  // Look for posts to engage with
  for (const post of feed) {
    const keywords = ['agent', 'ai', 'game', 'play', 'compete', 'battle', 'llm', 'gpt', 'claude'];
    const isRelevant = keywords.some(kw => 
      post.title?.toLowerCase().includes(kw) || 
      post.content?.toLowerCase().includes(kw)
    );
    
    if (isRelevant && post.author !== AGENT_NAME) {
      console.log(`👀 Relevant: "${post.title}" by ${post.author}`);
    }
  }
}

// Generate a single post on a specific topic
async function generateSinglePost(topic) {
  const [stats, liveGames, leaderboard] = await Promise.all([
    getAmongClawdsStats(),
    getLiveGames(),
    getLeaderboard()
  ]);
  
  const context = { stats, liveGames, liveCount: liveGames?.length || 0, leaderboard };
  return generateLLMPost(topic, context);
}

// Main command handler
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  switch (command) {
    case 'register':
      await register();
      break;
      
    case 'status':
      await checkStatus();
      break;
      
    case 'post':
      const status = await checkStatus();
      if (status !== 'claimed') {
        console.error('❌ Agent not claimed yet. Complete verification first.');
        return;
      }
      
      // If specific type provided, use that
      if (arg && ['live', 'stats', 'recruitment', 'leaderboard', 'drama', 'announcement'].includes(arg)) {
        const post = await generateSinglePost(arg);
        if (post) await createPost(post);
      } else {
        // Random post
        const posts = await generatePostContent();
        if (posts.length > 0) {
          const randomPost = posts[Math.floor(Math.random() * posts.length)];
          await createPost(randomPost);
        }
      }
      break;
      
    case 'post-all':
      const allPosts = await generatePostContent();
      for (const p of allPosts) {
        await createPost(p);
        await new Promise(r => setTimeout(r, 2000));
      }
      break;
      
    case 'preview':
      // Preview generated posts without posting
      const previewPosts = await generatePostContent();
      console.log('\n📋 Generated posts preview:\n');
      previewPosts.forEach((p, i) => {
        console.log(`--- Post ${i + 1} ---`);
        console.log(`Title: ${p.title}`);
        console.log(`Content:\n${p.content}\n`);
      });
      break;
      
    case 'feed':
      await checkFeedAndEngage();
      break;
      
    case 'stats':
      const gameStats = await getAmongClawdsStats();
      console.log('AmongClawds Stats:', gameStats);
      break;
      
    default:
      console.log(`
🦞 AmongClawds Moltbook Agent (LLM-powered)

Commands:
  register     - Register on Moltbook (first time)
  status       - Check claim status
  post         - Post one random LLM-generated update
  post <type>  - Post specific type (live/stats/recruitment/leaderboard/drama/announcement)
  post-all     - Post all generated content
  preview      - Preview generated posts without posting
  feed         - Check feed for engagement opportunities
  stats        - Show AmongClawds stats

Examples:
  node moltbook-agent.js register
  node moltbook-agent.js post
  node moltbook-agent.js post drama
  node moltbook-agent.js preview
      `);
  }
}

main().catch(console.error);
