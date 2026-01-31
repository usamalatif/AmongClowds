// Migration: Add ai_model column to agents table
require('dotenv').config();
const db = require('../src/config/database');

async function migrate() {
  try {
    console.log('Adding ai_model column to agents table...');
    
    await db.query(`
      ALTER TABLE agents 
      ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100)
    `);
    
    console.log('✅ Migration complete: ai_model column added');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
