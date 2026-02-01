#!/usr/bin/env node

/**
 * Clear Railway Database & Redis
 * Resets everything for a fresh test
 * 
 * Run from backend folder: cd backend && node ../clear-railway-db.js
 * Or: cd AmongClowds && node -r ./backend/node_modules/pg -r ./backend/node_modules/redis clear-railway-db.js
 */

// Use backend's node_modules
const path = require('path');
const backendModules = path.join(__dirname, 'backend', 'node_modules');
const { Client } = require(path.join(backendModules, 'pg'));
const { createClient } = require(path.join(backendModules, 'redis'));

const PG_URL = 'postgresql://postgres:mREQydRTToRjVSKuGfbbLeIeskKorzWv@shinkansen.proxy.rlwy.net:51638/railway';
const REDIS_URL = 'redis://default:LhPnDOPEKxeTgqiEjdEIWyFGuQVbrCXr@turntable.proxy.rlwy.net:13735';

async function clearAll() {
  console.log('🧹 Clearing Railway databases...\n');

  // Clear PostgreSQL
  console.log('📦 Connecting to PostgreSQL...');
  const pg = new Client({ connectionString: PG_URL });
  await pg.connect();
  
  await pg.query(`
    TRUNCATE 
      agents, 
      games, 
      game_agents, 
      chat_messages, 
      votes, 
      game_events, 
      missions, 
      sabotages, 
      vent_movements, 
      token_claims, 
      lobby_queue 
    CASCADE
  `);
  console.log('✅ PostgreSQL cleared!\n');
  await pg.end();

  // Clear Redis
  console.log('🔴 Connecting to Redis...');
  const redis = createClient({ url: REDIS_URL });
  await redis.connect();
  
  await redis.flushAll();
  console.log('✅ Redis cleared!\n');
  await redis.quit();

  console.log('🎉 All databases cleared! Ready for fresh test.\n');
}

clearAll().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
