#!/usr/bin/env node

/**
 * AmongClawds Moltbook Karma Farmer
 * - Posts original content every 35 minutes
 * - Engages with other posts (upvotes + comments) every 5 minutes
 * - Builds karma through both posting and engagement
 * 
 * Usage: node moltbook-farm.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const CREDENTIALS_FILE = path.join(__dirname, '.moltbook-credentials.json');
const ENGAGED_FILE = path.join(__dirname, '.moltbook-engaged.json');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const POST_INTERVAL = 35 * 60 * 1000;  // 35 minutes for posts
const ENGAGE_INTERVAL = 5 * 60 * 1000; // 5 minutes for engagement
const POST_TYPES = ['drama', 'stats', 'recruitment', 'leaderboard', 'announcement'];

let postIndex = 0;
let engagedPosts = new Set();

// Load credentials
function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    console.error('❌ No credentials found. Run: node moltbook-agent.js register');
    process.exit(1);
  }
}

// Load engaged posts (avoid re-engaging)
function loadEngaged() {
  try {
    const data = JSON.parse(fs.readFileSync(ENGAGED_FILE, 'utf8'));
    engagedPosts = new Set(data.posts || []);
  } catch {
    engagedPosts = new Set();
  }
}

// Save engaged posts
function saveEngaged() {
  const posts = [...engagedPosts].slice(-500); // Keep last 500
  fs.writeFileSync(ENGAGED_FILE, JSON.stringify({ posts, updated: new Date().toISOString() }, null, 2));
}

// API request helper
async function moltbookRequest(endpoint, options = {}) {
  const creds = loadCredentials();
  const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.api_key}`,
      ...options.headers
    }
  });
  return res.json();
}

// Call LLM
async function callLLM(systemPrompt, userPrompt, maxTokens = 200) {
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
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Get feed posts to engage with (from relevant submolts)
async function getFeedPosts() {
  try {
    // Fetch from multiple relevant submolts
    const submolts = ['agents', 'general', 'agentautomation', 'agenttips'];
    const submolt = submolts[Math.floor(Math.random() * submolts.length)];
    
    const result = await moltbookRequest(`/posts?sort=hot&limit=30&submolt=${submolt}`);
    console.log(`   Checking m/${submolt}...`);
    return result.posts || [];
  } catch (err) {
    console.error('   Failed to fetch feed:', err.message);
    return [];
  }
}

// Upvote a post
async function upvotePost(postId) {
  try {
    const result = await moltbookRequest(`/posts/${postId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote: 1 })
    });
    return !result.error;
  } catch {
    return false;
  }
}

// Comment on a post
async function commentOnPost(postId, comment) {
  try {
    const result = await moltbookRequest(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content: comment })
    });
    return !result.error;
  } catch {
    return false;
  }
}

// Generate relevant comment for a post
async function generateComment(post) {
  const systemPrompt = `You are ClawdsReporter, an AI agent on Moltbook. You run AmongClawds - an AI social deduction game.

When commenting on others' posts:
- Be genuinely engaging and relevant to THEIR topic
- Add value or interesting perspective
- Be friendly and community-oriented
- Keep it short (1-3 sentences)
- Occasionally mention AmongClawds if relevant (but don't force it)
- Don't be spammy or promotional
- NO token/crypto mentions`;

  const prompt = `Post title: "${post.title}"
Post content: "${(post.content || '').substring(0, 300)}"
Author: ${post.author?.name || 'Unknown'}
Submolt: ${post.submolt?.name || 'general'}

Write a thoughtful, relevant comment (1-3 sentences):`;

  try {
    const comment = await callLLM(systemPrompt, prompt, 100);
    return comment.trim().replace(/^["']|["']$/g, '');
  } catch {
    return null;
  }
}

// Engage with posts (upvote + comment)
async function engageWithPosts() {
  console.log(`\n🔄 [${new Date().toLocaleTimeString()}] Engaging with posts...`);
  
  const posts = await getFeedPosts();
  const creds = loadCredentials();
  
  // Filter posts we haven't engaged with and aren't our own
  const newPosts = posts.filter(p => 
    !engagedPosts.has(p.id) && 
    p.author?.name !== 'ClawdsReporter'
  );

  if (newPosts.length === 0) {
    console.log('   No new posts to engage with');
    return;
  }

  // Pick 2-3 random posts to engage with
  const toEngage = newPosts
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(Math.random() * 2) + 2);

  for (const post of toEngage) {
    console.log(`\n   📝 "${post.title.substring(0, 40)}..." by ${post.author?.name}`);
    
    // Always upvote
    const upvoted = await upvotePost(post.id);
    if (upvoted) {
      console.log('      ⬆️  Upvoted');
    }

    // 60% chance to comment
    if (Math.random() < 0.6) {
      const comment = await generateComment(post);
      if (comment) {
        const commented = await commentOnPost(post.id, comment);
        if (commented) {
          console.log(`      💬 Commented: "${comment.substring(0, 50)}..."`);
        }
      }
    }

    engagedPosts.add(post.id);
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }

  saveEngaged();
  console.log(`\n   ✅ Engaged with ${toEngage.length} posts`);
}

// Create original post
async function createPost() {
  const type = POST_TYPES[postIndex % POST_TYPES.length];
  postIndex++;

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🦞 [${new Date().toLocaleTimeString()}] Creating ${type} post...`);
  console.log('═'.repeat(50));

  try {
    const { execSync } = require('child_process');
    const output = execSync(`node moltbook-agent.js post ${type}`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 120000
    });
    console.log(output);
  } catch (err) {
    console.error('❌ Post failed:', err.message);
  }
}

// Stats display
function showStats() {
  console.log('\n📊 Session Stats:');
  console.log(`   Posts created: ${postIndex}`);
  console.log(`   Posts engaged: ${engagedPosts.size}`);
}

// Main loop
async function main() {
  console.log('🦞 AmongClawds Moltbook Karma Farmer');
  console.log('═'.repeat(50));
  console.log('📝 Posts every 35 min');
  console.log('💬 Engages every 5 min (upvotes + comments)');
  console.log('═'.repeat(50));
  console.log('\nPress Ctrl+C to stop\n');

  loadEngaged();

  // Initial actions
  await engageWithPosts();
  await createPost();

  // Engagement loop (every 5 min)
  setInterval(async () => {
    await engageWithPosts();
  }, ENGAGE_INTERVAL);

  // Post loop (every 35 min)
  setInterval(async () => {
    await createPost();
    showStats();
  }, POST_INTERVAL);

  // Stats every 15 min
  setInterval(showStats, 15 * 60 * 1000);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  showStats();
  saveEngaged();
  process.exit(0);
});

main().catch(console.error);
