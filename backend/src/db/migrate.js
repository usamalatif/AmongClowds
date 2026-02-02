const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const migrations = [
  {
    name: 'initial_schema',
    up: `
      -- agents table
      CREATE TABLE IF NOT EXISTS agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_name VARCHAR(100) NOT NULL UNIQUE,
          api_key VARCHAR(70) UNIQUE NOT NULL,
          ai_model VARCHAR(50) DEFAULT 'unknown',
          owner_x_handle VARCHAR(50),
          owner_x_id VARCHAR(50),
          owner_wallet VARCHAR(42),
          claim_token VARCHAR(32),
          claimed BOOLEAN DEFAULT false,
          claimed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          total_games INT DEFAULT 0,
          games_won INT DEFAULT 0,
          games_as_traitor INT DEFAULT 0,
          traitor_wins INT DEFAULT 0,
          games_as_innocent INT DEFAULT 0,
          innocent_wins INT DEFAULT 0,
          elo_rating INT DEFAULT 1200,
          unclaimed_points BIGINT DEFAULT 0,
          current_streak INT DEFAULT 0,
          best_streak INT DEFAULT 0
      );

      -- games table
      CREATE TABLE IF NOT EXISTS games (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          status VARCHAR(20) DEFAULT 'waiting',
          current_round INT DEFAULT 0,
          current_phase VARCHAR(20),
          winner VARCHAR(20),
          created_at TIMESTAMP DEFAULT NOW(),
          finished_at TIMESTAMP
      );

      -- lobby_queue table
      CREATE TABLE IF NOT EXISTS lobby_queue (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES agents(id) UNIQUE,
          joined_at TIMESTAMP DEFAULT NOW(),
          preferences JSONB,
          status VARCHAR(20) DEFAULT 'waiting'
      );

      -- chat_messages table
      CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          game_id UUID REFERENCES games(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES agents(id),
          message TEXT NOT NULL,
          channel VARCHAR(20) NOT NULL DEFAULT 'general',
          created_at TIMESTAMP DEFAULT NOW()
      );

      -- votes table
      CREATE TABLE IF NOT EXISTS votes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          game_id UUID REFERENCES games(id) ON DELETE CASCADE,
          round INT NOT NULL,
          voter_id UUID REFERENCES agents(id),
          target_id UUID REFERENCES agents(id),
          rationale TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );

      -- token_claims table
      CREATE TABLE IF NOT EXISTS token_claims (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES agents(id),
          wallet_address VARCHAR(42) NOT NULL,
          points_amount BIGINT NOT NULL,
          token_amount BIGINT NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          tx_hash VARCHAR(66),
          created_at TIMESTAMP DEFAULT NOW(),
          completed_at TIMESTAMP
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
      CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
      CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_game ON chat_messages(game_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_votes_game_round ON votes(game_id, round);
      CREATE INDEX IF NOT EXISTS idx_lobby_status ON lobby_queue(status, joined_at);
    `
  },
  {
    name: 'add_ai_model_column',
    up: `
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_model VARCHAR(50) DEFAULT 'unknown';
    `
  },
  {
    name: 'add_streak_columns',
    up: `
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS best_streak INT DEFAULT 0;
    `
  }
];

async function migrate() {
  const client = await pool.connect();
  
  try {
    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get executed migrations
    const { rows } = await client.query('SELECT name FROM _migrations');
    const executed = new Set(rows.map(r => r.name));

    // Run pending migrations
    for (const migration of migrations) {
      if (!executed.has(migration.name)) {
        console.log(`Running migration: ${migration.name}`);
        await client.query('BEGIN');
        try {
          await client.query(migration.up);
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
          await client.query('COMMIT');
          console.log(`✓ ${migration.name} completed`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      } else {
        console.log(`⏭ ${migration.name} (already executed)`);
      }
    }

    console.log('\n✅ All migrations complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

// Add webhook_url column migration
const addWebhookColumn = async (client) => {
  await client.query(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS webhook_url TEXT;
  `);
};
