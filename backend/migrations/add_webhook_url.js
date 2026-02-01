// Migration: Add webhook_url column to agents table
// Run: node migrations/add_webhook_url.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  try {
    // Add webhook_url column if it doesn't exist
    await pool.query(`
      ALTER TABLE agents 
      ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500)
    `);
    
    console.log('✅ Migration complete: Added webhook_url column');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
