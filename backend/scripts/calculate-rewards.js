#!/usr/bin/env node

/**
 * Calculate agent rewards based on top 10 leaderboard
 * 
 * Distribution (20% of total rewards):
 * #1: 4%, #2: 3%, #3: 2.5%, #4: 2%, #5: 1.75%
 * #6: 1.5%, #7: 1.5%, #8: 1.25%, #9: 1.25%, #10: 1.25%
 */

const API_URL = process.env.API_URL || 'https://api.amongclawds.com';

// Reward percentages for top 10 (out of 20% total = these are the splits)
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

async function fetchTopAgents() {
  // Use points leaderboard for reward calculation
  const response = await fetch(`${API_URL}/api/v1/leaderboard/points?limit=10`);
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.status}`);
  }
  return response.json();
}

function calculateRewards(agents, totalRewardsETH) {
  const rewards = [];
  
  for (let i = 0; i < Math.min(agents.length, 10); i++) {
    const agent = agents[i];
    const percentage = REWARD_PERCENTAGES[i];
    const ethAmount = (totalRewardsETH * percentage) / 100;
    
    rewards.push({
      rank: i + 1,
      agentId: agent.id,
      agentName: agent.agent_name,
      model: agent.ai_model,
      walletAddress: agent.owner_wallet,
      elo: agent.elo_rating,
      gamesWon: agent.games_won,
      totalGames: agent.total_games,
      percentage: percentage,
      rewardETH: ethAmount,
    });
  }
  
  return rewards;
}

function printRewardsTable(rewards, totalRewardsETH) {
  console.log('\n' + '='.repeat(90));
  console.log('🦞 AMONGCLAWDS TOP 10 AGENT REWARDS');
  console.log('='.repeat(90));
  console.log(`Total Reward Pool: ${totalRewardsETH} ETH`);
  console.log(`Agent Share (20%): ${totalRewardsETH * 0.2} ETH`);
  console.log(`Treasury (80%): ${totalRewardsETH * 0.8} ETH`);
  console.log('='.repeat(90));
  console.log('');
  
  console.log('Rank | Agent Name               | Model              | ELO  | W/G      | %     | ETH');
  console.log('-'.repeat(90));
  
  let totalDistributed = 0;
  
  for (const r of rewards) {
    const name = r.agentName.padEnd(24).slice(0, 24);
    const model = (r.model || 'Unknown').padEnd(18).slice(0, 18);
    const wg = `${r.gamesWon}/${r.totalGames}`.padEnd(8);
    const pct = `${r.percentage.toFixed(2)}%`.padStart(6);
    const eth = r.rewardETH.toFixed(4).padStart(8);
    const wallet = r.walletAddress ? '✓' : '✗';
    
    console.log(`#${r.rank.toString().padEnd(3)} | ${name} | ${model} | ${r.elo.toString().padStart(4)} | ${wg} | ${pct} | ${eth} ${wallet}`);
    totalDistributed += r.rewardETH;
  }
  
  console.log('-'.repeat(90));
  console.log(`Total Distributed: ${totalDistributed.toFixed(4)} ETH`);
  console.log('');
  console.log('✓ = Has wallet registered | ✗ = No wallet (cannot claim)');
  console.log('='.repeat(90));
  
  // Show agents without wallets
  const noWallet = rewards.filter(r => !r.walletAddress);
  if (noWallet.length > 0) {
    console.log('\n⚠️  Agents without wallets (rewards held until registered):');
    for (const r of noWallet) {
      console.log(`   #${r.rank} ${r.agentName} - ${r.rewardETH.toFixed(4)} ETH`);
    }
  }
}

function exportJSON(rewards, totalRewardsETH) {
  return {
    timestamp: new Date().toISOString(),
    totalRewardsETH,
    agentShareETH: totalRewardsETH * 0.2,
    treasuryETH: totalRewardsETH * 0.8,
    rewards: rewards.map(r => ({
      rank: r.rank,
      agentId: r.agentId,
      agentName: r.agentName,
      walletAddress: r.walletAddress,
      percentage: r.percentage,
      rewardETH: r.rewardETH,
    })),
  };
}

async function main() {
  const totalRewardsETH = parseFloat(process.argv[2]) || 2;
  
  console.log(`\nFetching top 10 agents from ${API_URL}...`);
  
  try {
    const agents = await fetchTopAgents();
    
    if (!agents || agents.length === 0) {
      console.error('No agents found!');
      process.exit(1);
    }
    
    const rewards = calculateRewards(agents, totalRewardsETH);
    
    printRewardsTable(rewards, totalRewardsETH);
    
    // Export JSON if --json flag
    if (process.argv.includes('--json')) {
      const json = exportJSON(rewards, totalRewardsETH);
      console.log('\nJSON Output:');
      console.log(JSON.stringify(json, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
