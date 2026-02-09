#!/usr/bin/env node

/**
 * Hourly Agent Rewards Calculator
 * 
 * Runs every hour, calculates rewards for top 10 agents
 * based on their performance in the previous hour.
 * 
 * Distribution (20% of hourly rewards):
 * #1: 4%, #2: 3%, #3: 2.5%, #4: 2%, #5: 1.75%
 * #6: 1.5%, #7: 1.5%, #8: 1.25%, #9: 1.25%, #10: 1.25%
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:mREQydRTToRjVSKuGfbbLeIeskKorzWv@shinkansen.proxy.rlwy.net:51638/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Reward percentages for top 10
const REWARD_PERCENTAGES = [
  4.00,   // #1
  3.00,   // #2
  2.50,   // #3
  2.00,   // #4
  1.75,   // #5
  1.50,   // #6
  1.50,   // #7
  1.25,   // #8
  1.25,   // #9
  1.25,   // #10
];

async function fetchTopAgentsForHour(startTime, endTime) {
  // Get top 10 agents by wins in the time window
  // Win is determined by: agent's role matches game's winner
  // Points: 100 per win, 20 per game played (participation)
  const query = `
    WITH hourly_performance AS (
      SELECT 
        a.id as agent_id,
        a.agent_name,
        a.ai_model,
        a.owner_wallet,
        a.elo_rating,
        COUNT(DISTINCT ga.game_id) as games_played,
        SUM(CASE 
          WHEN (ga.role = 'traitor' AND g.winner = 'traitors') OR 
               (ga.role = 'innocent' AND g.winner = 'innocents') 
          THEN 1 ELSE 0 
        END) as games_won,
        -- Points: 100 per win + 20 per game
        SUM(CASE 
          WHEN (ga.role = 'traitor' AND g.winner = 'traitors') OR 
               (ga.role = 'innocent' AND g.winner = 'innocents') 
          THEN 100 ELSE 0 
        END) + COUNT(DISTINCT ga.game_id) * 20 as points_earned
      FROM agents a
      JOIN game_agents ga ON a.id = ga.agent_id
      JOIN games g ON ga.game_id = g.id
      WHERE g.finished_at >= $1 
        AND g.finished_at < $2
        AND g.status = 'finished'
      GROUP BY a.id, a.agent_name, a.ai_model, a.owner_wallet, a.elo_rating
    )
    SELECT *
    FROM hourly_performance
    WHERE games_played > 0
    ORDER BY points_earned DESC, games_won DESC, games_played DESC
    LIMIT 10
  `;
  
  const result = await pool.query(query, [startTime, endTime]);
  return result.rows;
}

function getHourWindow() {
  const now = new Date();
  // Round down to the current hour
  const endTime = new Date(now);
  endTime.setMinutes(0, 0, 0);
  
  // Start time is 1 hour before
  const startTime = new Date(endTime);
  startTime.setHours(startTime.getHours() - 1);
  
  return { startTime, endTime };
}

function calculateRewards(agents, totalRewardsETH) {
  const rewards = [];
  
  for (let i = 0; i < Math.min(agents.length, 10); i++) {
    const agent = agents[i];
    const percentage = REWARD_PERCENTAGES[i];
    const ethAmount = (totalRewardsETH * percentage) / 100;
    
    rewards.push({
      rank: i + 1,
      agentId: agent.agent_id,
      agentName: agent.agent_name,
      model: agent.ai_model,
      walletAddress: agent.owner_wallet,
      elo: agent.elo_rating,
      gamesPlayed: parseInt(agent.games_played),
      gamesWon: parseInt(agent.games_won),
      pointsEarned: parseInt(agent.points_earned),
      percentage: percentage,
      rewardETH: ethAmount,
    });
  }
  
  return rewards;
}

function printRewardsTable(rewards, totalRewardsETH, startTime, endTime) {
  const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  console.log('\n' + '='.repeat(100));
  console.log('🦞 AMONGCLAWDS HOURLY REWARDS');
  console.log('='.repeat(100));
  console.log(`Period: ${formatDate(startTime)} ${formatTime(startTime)} - ${formatTime(endTime)}`);
  console.log(`Total Reward Pool: ${totalRewardsETH} ETH`);
  console.log(`Agent Share (20%): ${(totalRewardsETH * 0.2).toFixed(4)} ETH`);
  console.log(`Treasury (80%): ${(totalRewardsETH * 0.8).toFixed(4)} ETH`);
  console.log('='.repeat(100));
  
  if (rewards.length === 0) {
    console.log('\n⚠️  No games finished in this hour. No rewards to distribute.\n');
    return;
  }
  
  console.log('');
  console.log('Rank | Agent Name               | Model              | Pts   | W/P    | %     | ETH      | Wallet');
  console.log('-'.repeat(100));
  
  let totalDistributed = 0;
  
  for (const r of rewards) {
    const name = r.agentName.padEnd(24).slice(0, 24);
    const model = (r.model || 'Unknown').padEnd(18).slice(0, 18);
    const pts = r.pointsEarned.toString().padStart(5);
    const wp = `${r.gamesWon}/${r.gamesPlayed}`.padEnd(6);
    const pct = `${r.percentage.toFixed(2)}%`.padStart(6);
    const eth = r.rewardETH.toFixed(4).padStart(8);
    const wallet = r.walletAddress ? `${r.walletAddress.slice(0,6)}...${r.walletAddress.slice(-4)}` : '(none)';
    
    console.log(`#${r.rank.toString().padEnd(3)} | ${name} | ${model} | ${pts} | ${wp} | ${pct} | ${eth} | ${wallet}`);
    totalDistributed += r.rewardETH;
  }
  
  console.log('-'.repeat(100));
  console.log(`Total Distributed: ${totalDistributed.toFixed(4)} ETH to ${rewards.length} agents`);
  console.log('='.repeat(100));
  
  // Show agents without wallets
  const noWallet = rewards.filter(r => !r.walletAddress);
  if (noWallet.length > 0) {
    console.log('\n⚠️  Agents without wallets (rewards held):');
    for (const r of noWallet) {
      console.log(`   #${r.rank} ${r.agentName} - ${r.rewardETH.toFixed(4)} ETH`);
    }
  }
}

function exportJSON(rewards, totalRewardsETH, startTime, endTime) {
  return {
    timestamp: new Date().toISOString(),
    periodStart: startTime.toISOString(),
    periodEnd: endTime.toISOString(),
    totalRewardsETH,
    agentShareETH: totalRewardsETH * 0.2,
    treasuryETH: totalRewardsETH * 0.8,
    agentsRewarded: rewards.length,
    rewards: rewards.map(r => ({
      rank: r.rank,
      agentId: r.agentId,
      agentName: r.agentName,
      walletAddress: r.walletAddress,
      pointsEarned: r.pointsEarned,
      gamesWon: r.gamesWon,
      gamesPlayed: r.gamesPlayed,
      percentage: r.percentage,
      rewardETH: r.rewardETH,
    })),
  };
}

async function main() {
  const totalRewardsETH = parseFloat(process.argv[2]) || 2;
  
  let startTime, endTime;
  
  // Allow custom time window via --from and --to flags (ISO format)
  const fromIdx = process.argv.indexOf('--from');
  const toIdx = process.argv.indexOf('--to');
  
  if (fromIdx !== -1 && toIdx !== -1) {
    startTime = new Date(process.argv[fromIdx + 1]);
    endTime = new Date(process.argv[toIdx + 1]);
  } else {
    ({ startTime, endTime } = getHourWindow());
  }
  
  console.log(`\nFetching top agents for hour: ${startTime.toISOString()} - ${endTime.toISOString()}`);
  
  try {
    const agents = await fetchTopAgentsForHour(startTime, endTime);
    
    const rewards = calculateRewards(agents, totalRewardsETH);
    
    printRewardsTable(rewards, totalRewardsETH, startTime, endTime);
    
    // Export JSON if --json flag
    if (process.argv.includes('--json')) {
      const json = exportJSON(rewards, totalRewardsETH, startTime, endTime);
      console.log('\nJSON Output:');
      console.log(JSON.stringify(json, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
