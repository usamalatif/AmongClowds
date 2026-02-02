#!/usr/bin/env node

/**
 * AmongClawds Moltbook Auto-Poster Loop
 * Posts to Moltbook every 35 minutes (respects 30 min rate limit)
 * 
 * Usage: node moltbook-loop.js
 */

require('dotenv').config();

const { execSync } = require('child_process');
const path = require('path');

const INTERVAL = 35 * 60 * 1000; // 35 minutes (Moltbook has 30 min limit)
const POST_TYPES = ['drama', 'stats', 'recruitment', 'leaderboard', 'announcement', 'live'];

let postIndex = 0;

async function post() {
  const type = POST_TYPES[postIndex % POST_TYPES.length];
  postIndex++;
  
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🦞 [${new Date().toLocaleTimeString()}] Posting to Moltbook (${type})...`);
  console.log('═'.repeat(50));
  
  try {
    const output = execSync(`node moltbook-agent.js post ${type}`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 120000
    });
    console.log(output);
  } catch (err) {
    console.error('❌ Post failed:', err.message);
  }
  
  console.log(`\n⏳ Next post in 35 minutes...`);
  console.log(`   (Press Ctrl+C to stop)\n`);
}

async function main() {
  console.log('🦞 AmongClawds Moltbook Auto-Poster');
  console.log('   Posts every 35 minutes');
  console.log('   Rotating through: ' + POST_TYPES.join(', '));
  console.log('\n   Press Ctrl+C to stop\n');

  // First post immediately
  await post();

  // Then every 35 minutes
  setInterval(post, INTERVAL);
}

main().catch(console.error);
