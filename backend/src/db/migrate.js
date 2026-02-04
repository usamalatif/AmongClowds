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
  },
  {
    name: 'add_spectator_predictions',
    up: `
      -- Spectator predictions table
      CREATE TABLE IF NOT EXISTS predictions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          game_id UUID REFERENCES games(id) ON DELETE CASCADE,
          spectator_id VARCHAR(100) NOT NULL,
          predicted_traitor_ids UUID[] NOT NULL,
          points_earned INT DEFAULT 0,
          is_correct BOOLEAN,
          created_at TIMESTAMP DEFAULT NOW()
      );

      -- Each spectator can only predict once per game
      CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_unique ON predictions(game_id, spectator_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_id);
    `
  },
  {
    name: 'add_achievements',
    up: `
      -- Achievement definitions
      CREATE TABLE IF NOT EXISTS achievements (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          icon VARCHAR(10) NOT NULL,
          category VARCHAR(30) NOT NULL,
          requirement_type VARCHAR(30) NOT NULL,
          requirement_value INT NOT NULL,
          points INT DEFAULT 0,
          rarity VARCHAR(20) DEFAULT 'common',
          created_at TIMESTAMP DEFAULT NOW()
      );

      -- Agent achievements (unlocked)
      CREATE TABLE IF NOT EXISTS agent_achievements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
          achievement_id VARCHAR(50) REFERENCES achievements(id),
          unlocked_at TIMESTAMP DEFAULT NOW(),
          game_id UUID REFERENCES games(id),
          UNIQUE(agent_id, achievement_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_achievements ON agent_achievements(agent_id);

      -- Seed default achievements
      INSERT INTO achievements (id, name, description, icon, category, requirement_type, requirement_value, points, rarity) VALUES
        -- Games played
        ('first_blood', 'First Blood', 'Play your first game', '🎮', 'games', 'games_played', 1, 10, 'common'),
        ('veteran', 'Veteran', 'Play 10 games', '⭐', 'games', 'games_played', 10, 25, 'common'),
        ('grizzled', 'Grizzled', 'Play 50 games', '🎖️', 'games', 'games_played', 50, 100, 'rare'),
        ('legend', 'Living Legend', 'Play 100 games', '👑', 'games', 'games_played', 100, 250, 'epic'),

        -- Wins
        ('first_win', 'Winner Winner', 'Win your first game', '🏆', 'wins', 'games_won', 1, 15, 'common'),
        ('champion', 'Champion', 'Win 10 games', '🥇', 'wins', 'games_won', 10, 50, 'uncommon'),
        ('dominator', 'Dominator', 'Win 25 games', '💪', 'wins', 'games_won', 25, 150, 'rare'),
        ('unstoppable', 'Unstoppable', 'Win 50 games', '🔥', 'wins', 'games_won', 50, 300, 'epic'),

        -- Streaks
        ('hot_streak', 'Hot Streak', 'Win 3 games in a row', '🔥', 'streaks', 'best_streak', 3, 30, 'uncommon'),
        ('on_fire', 'On Fire', 'Win 5 games in a row', '🌟', 'streaks', 'best_streak', 5, 75, 'rare'),
        ('blazing', 'Blazing', 'Win 10 games in a row', '💫', 'streaks', 'best_streak', 10, 200, 'epic'),

        -- Traitor
        ('first_betrayal', 'First Betrayal', 'Win your first game as traitor', '🗡️', 'traitor', 'traitor_wins', 1, 20, 'common'),
        ('deceiver', 'Master Deceiver', 'Win 5 games as traitor', '🎭', 'traitor', 'traitor_wins', 5, 60, 'uncommon'),
        ('mastermind', 'Mastermind', 'Win 15 games as traitor', '🧠', 'traitor', 'traitor_wins', 15, 150, 'rare'),
        ('puppet_master', 'Puppet Master', 'Win 30 games as traitor', '👿', 'traitor', 'traitor_wins', 30, 350, 'legendary'),

        -- Innocent
        ('survivor', 'Survivor', 'Win your first game as innocent', '🛡️', 'innocent', 'innocent_wins', 1, 15, 'common'),
        ('detective', 'Detective', 'Win 5 games as innocent', '🔍', 'innocent', 'innocent_wins', 5, 50, 'uncommon'),
        ('sherlock', 'Sherlock', 'Win 15 games as innocent', '🕵️', 'innocent', 'innocent_wins', 15, 125, 'rare'),
        ('guardian', 'Guardian Angel', 'Win 30 games as innocent', '😇', 'innocent', 'innocent_wins', 30, 300, 'legendary'),

        -- ELO
        ('rising_star', 'Rising Star', 'Reach 1300 ELO', '📈', 'elo', 'elo_rating', 1300, 50, 'uncommon'),
        ('elite', 'Elite', 'Reach 1500 ELO', '💎', 'elo', 'elo_rating', 1500, 150, 'rare'),
        ('grandmaster', 'Grandmaster', 'Reach 1800 ELO', '🏅', 'elo', 'elo_rating', 1800, 400, 'legendary')
      ON CONFLICT (id) DO NOTHING;
    `
  },
  {
    name: 'add_wallet_to_predictions',
    up: `
      ALTER TABLE predictions ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_wallet_game 
        ON predictions(game_id, wallet_address) WHERE wallet_address IS NOT NULL;
    `
  },
  {
    name: 'add_webhook_url_column',
    up: `
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS webhook_url TEXT;
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

