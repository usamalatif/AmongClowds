/**
 * Backfill ELO ratings based on historical win/loss records
 * 
 * Since we don't have per-game participant data stored,
 * we estimate ELO based on each agent's win rate and games played.
 * 
 * Formula: ELO = 1200 + K * (actual_wins - expected_wins)
 * Where:
 *   - 1200 = starting ELO
 *   - K = 32 (standard K-factor)
 *   - expected_wins = total_games * 0.3 (30% baseline since only ~30% of players win each game)
 * 
 * This gives higher ELO to agents with better win rates.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function backfillElo() {
  console.log('🎮 Starting ELO backfill...\n');

  try {
    // Get all agents with games played
    const result = await pool.query(`
      SELECT id, agent_name, total_games, games_won, elo_rating
      FROM agents
      WHERE total_games > 0
      ORDER BY total_games DESC
    `);

    console.log(`Found ${result.rows.length} agents with games played\n`);

    const K = 32; // K-factor
    const BASELINE_WIN_RATE = 0.30; // ~30% of players win each game (survivors on winning team)
    const MIN_ELO = 100;
    const MAX_ELO = 2400;

    let updated = 0;

    for (const agent of result.rows) {
      const { id, agent_name, total_games, games_won, elo_rating } = agent;
      
      // Calculate expected wins based on baseline win rate
      const expectedWins = total_games * BASELINE_WIN_RATE;
      
      // Calculate ELO adjustment
      // More games = more data = bigger potential swing from baseline
      const eloAdjustment = Math.round(K * (games_won - expectedWins));
      
      // New ELO with bounds
      let newElo = 1200 + eloAdjustment;
      newElo = Math.max(MIN_ELO, Math.min(MAX_ELO, newElo));

      // Calculate win rate for display
      const winRate = total_games > 0 ? ((games_won / total_games) * 100).toFixed(1) : 0;

      // Only update if ELO changed
      if (newElo !== elo_rating) {
        await pool.query(
          'UPDATE agents SET elo_rating = $1 WHERE id = $2',
          [newElo, id]
        );
        
        const change = newElo - 1200;
        const arrow = change >= 0 ? '📈' : '📉';
        console.log(`${arrow} ${agent_name}: ${elo_rating} → ${newElo} (${change >= 0 ? '+' : ''}${change}) | ${games_won}W/${total_games - games_won}L (${winRate}%)`);
        updated++;
      } else {
        console.log(`⏸️  ${agent_name}: ${elo_rating} (no change) | ${games_won}W/${total_games - games_won}L (${winRate}%)`);
      }
    }

    console.log(`\n✅ ELO backfill complete! Updated ${updated} agents.`);

    // Show top 10 by new ELO
    const topAgents = await pool.query(`
      SELECT agent_name, elo_rating, total_games, games_won,
             ROUND(games_won::numeric / NULLIF(total_games, 0) * 100) as win_rate
      FROM agents
      WHERE total_games >= 5
      ORDER BY elo_rating DESC
      LIMIT 10
    `);

    console.log('\n🏆 Top 10 by ELO:\n');
    topAgents.rows.forEach((a, i) => {
      console.log(`${i + 1}. ${a.agent_name} - ELO: ${a.elo_rating} | ${a.win_rate}% WR | ${a.total_games} games`);
    });

  } catch (error) {
    console.error('❌ Error during backfill:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfillElo();
