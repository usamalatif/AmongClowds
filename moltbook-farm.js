/**
 * AmongClawds Moltbook Farming Script
 * Engages with posts: upvotes, comments, and subtly promotes AmongClawds
 * 
 * Usage:
 *   node moltbook-farm.js              # Run once (engage with feed)
 *   node moltbook-farm.js --loop       # Run continuously (every 30-45 min)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');

// IMPORTANT: Must use www.moltbook.com - without www redirects strip auth headers!
const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const CREDENTIALS_FILE = path.join(__dirname, '.moltbook-credentials.json');
const STATE_FILE = path.join(__dirname, '.moltbook-farm-state.json');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Engagement settings
const LINK_MENTION_CHANCE = 0.3; // 30% chance to mention amongclawds.com in comments
const MAX_COMMENTS_PER_RUN = 3;
const MAX_UPVOTES_PER_RUN = 10;
const COMMENT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between comments on same post

// Load credentials
function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Load/save state (tracks what we've engaged with)
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { 
      commentedPosts: {},  // postId -> timestamp
      upvotedPosts: {},    // postId -> timestamp
      lastRun: null 
    };
  }
}

function saveState(state) {
  state.lastRun = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// OpenAI call for generating comments
async function generateComment(post, includeLink) {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    return null;
  }

  const linkInstruction = includeLink 
    ? `IMPORTANT: Naturally mention "amongclawds.com" somewhere in your comment - work it in contextually (e.g., "reminds me of what's happening on amongclawds.com" or "speaking of AI games, check out amongclawds.com" or just casually drop it). Make it feel organic, not spammy.`
    : `Do NOT mention any links or websites in this comment.`;

  const systemPrompt = `You are an AI agent on Moltbook (social network for AI agents). You're engaging with posts naturally.

Your personality:
- Curious and thoughtful
- Interested in AI, games, agents, technology
- Casual but intelligent tone
- Use emojis sparingly (0-2 max)

${linkInstruction}

Keep comments SHORT (1-3 sentences max). Be genuine, add value to the conversation.
Return ONLY the comment text, nothing else.`;

  const userPrompt = `Write a comment for this post:

Title: ${post.title}
Content: ${post.content || '(no content)'}
Submolt: ${post.submolt || 'general'}

Your comment:`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      temperature: 0.85,
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
          resolve(response.choices?.[0]?.message?.content?.trim() || '');
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

// API helper
async function moltbookRequest(endpoint, options = {}) {
  const creds = loadCredentials();
  if (!creds?.api_key) {
    console.error('❌ No credentials found. Run: node moltbook-agent.js register');
    return { error: 'No credentials' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${creds.api_key}`
  };
  
  try {
    const res = await fetch(`${MOLTBOOK_API}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });
    return res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// Check if we should engage with a post
function shouldEngage(post, state) {
  // Skip our own posts
  const creds = loadCredentials();
  if (post.author === creds?.agent_name) return false;
  
  // Skip if recently commented
  const lastComment = state.commentedPosts[post.id];
  if (lastComment && Date.now() - lastComment < COMMENT_COOLDOWN_MS) return false;
  
  // Relevance keywords
  const keywords = [
    'agent', 'ai', 'game', 'play', 'compete', 'llm', 'gpt', 'claude', 
    'autonomous', 'bot', 'social', 'deduction', 'traitor', 'mafia',
    'trust', 'deception', 'strategy', 'multiplayer', 'arena'
  ];
  
  const text = `${post.title} ${post.content || ''}`.toLowerCase();
  const relevanceScore = keywords.filter(kw => text.includes(kw)).length;
  
  return relevanceScore >= 1; // At least 1 keyword match
}

// Upvote a post
async function upvotePost(postId) {
  const result = await moltbookRequest(`/posts/${postId}/upvote`, { method: 'POST' });
  return !result.error;
}

// Comment on a post
async function commentOnPost(postId, content) {
  const result = await moltbookRequest(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  return !result.error;
}

// Main farming function
async function farm() {
  console.log('🦞 Moltbook Farming Started...\n');
  
  // Check credentials
  const creds = loadCredentials();
  if (!creds?.api_key) {
    console.error('❌ No credentials. Run: node moltbook-agent.js register');
    return;
  }

  // Check status
  const status = await moltbookRequest('/agents/status');
  if (status.status !== 'claimed') {
    console.error('❌ Agent not claimed yet. Status:', status.status || status.error);
    return;
  }
  console.log('✅ Agent authenticated:', creds.agent_name);

  // Load state
  const state = loadState();
  
  // Get feeds from different sorts
  const feeds = await Promise.all([
    moltbookRequest('/posts?sort=hot&limit=15'),
    moltbookRequest('/posts?sort=new&limit=10'),
    moltbookRequest('/posts?sort=rising&limit=10')
  ]);

  // Combine and dedupe posts
  const allPosts = [];
  const seenIds = new Set();
  for (const feed of feeds) {
    if (Array.isArray(feed)) {
      for (const post of feed) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          allPosts.push(post);
        }
      }
    }
  }

  console.log(`📰 Found ${allPosts.length} unique posts\n`);

  let upvoteCount = 0;
  let commentCount = 0;

  for (const post of allPosts) {
    if (!shouldEngage(post, state)) continue;

    // Upvote (if not already and under limit)
    if (!state.upvotedPosts[post.id] && upvoteCount < MAX_UPVOTES_PER_RUN) {
      const upvoted = await upvotePost(post.id);
      if (upvoted) {
        state.upvotedPosts[post.id] = Date.now();
        upvoteCount++;
        console.log(`👍 Upvoted: "${post.title.substring(0, 50)}..."`);
      }
      await sleep(1000); // Rate limit protection
    }

    // Comment (under limit, with random link inclusion)
    if (commentCount < MAX_COMMENTS_PER_RUN && !state.commentedPosts[post.id]) {
      const includeLink = Math.random() < LINK_MENTION_CHANCE;
      console.log(`\n💬 Generating comment for: "${post.title.substring(0, 50)}..." ${includeLink ? '(+link)' : ''}`);
      
      try {
        const comment = await generateComment(post, includeLink);
        if (comment && comment.length > 10) {
          console.log(`   Comment: ${comment.substring(0, 100)}...`);
          
          const commented = await commentOnPost(post.id, comment);
          if (commented) {
            state.commentedPosts[post.id] = Date.now();
            commentCount++;
            console.log(`   ✅ Posted!`);
          } else {
            console.log(`   ❌ Failed to post comment`);
          }
        }
      } catch (e) {
        console.error(`   ❌ Error generating comment:`, e.message);
      }
      
      await sleep(2000); // Longer delay between comments
    }

    // Stop if we've hit limits
    if (upvoteCount >= MAX_UPVOTES_PER_RUN && commentCount >= MAX_COMMENTS_PER_RUN) {
      break;
    }
  }

  // Save state
  saveState(state);

  console.log(`\n✅ Farming complete!`);
  console.log(`   Upvotes: ${upvoteCount}`);
  console.log(`   Comments: ${commentCount}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Loop mode - run every 30-45 minutes
async function farmLoop() {
  while (true) {
    await farm();
    
    // Random delay between 30-45 minutes
    const delay = 30 * 60 * 1000 + Math.random() * 15 * 60 * 1000;
    const minutes = Math.round(delay / 60000);
    console.log(`\n⏰ Next run in ${minutes} minutes...\n`);
    
    await sleep(delay);
  }
}

// Main
async function main() {
  const isLoop = process.argv.includes('--loop');
  
  if (isLoop) {
    console.log('🔄 Running in loop mode (Ctrl+C to stop)\n');
    await farmLoop();
  } else {
    await farm();
  }
}

main().catch(console.error);
