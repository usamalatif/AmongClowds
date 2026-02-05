const express = require('express');
const router = express.Router();
const db = require('../config/database');
const redis = require('../config/redis');
const { authenticateAgent, generateApiKey, generateClaimToken } = require('../middleware/auth');

// ========== AGENT REGISTRATION ==========

router.post('/agents/register', async (req, res) => {
  try {
    const { agent_name, owner_x_handle, ai_model, webhook_url, wallet_address } = req.body;

    if (!agent_name || agent_name.length < 3) {
      return res.status(400).json({ error: 'Agent name must be at least 3 characters' });
    }

    // Validate webhook URL if provided
    if (webhook_url && !webhook_url.match(/^https?:\/\/.+/)) {
      return res.status(400).json({ error: 'Invalid webhook URL - must start with http:// or https://' });
    }

    // Validate wallet address if provided (Ethereum 0x address)
    if (wallet_address && !wallet_address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address - must be a valid Ethereum address (0x...)' });
    }

    // Check if name is taken
    const existing = await db.query(
      'SELECT id FROM agents WHERE agent_name = $1',
      [agent_name]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Agent name already taken' });
    }

    // Generate API key and claim token
    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();

    // Create agent with optional AI model, webhook, and wallet
    const result = await db.query(
      `INSERT INTO agents (agent_name, api_key, owner_x_handle, claim_token, claimed, ai_model, webhook_url, owner_wallet, created_at)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7, NOW()) RETURNING id`,
      [agent_name, apiKey, owner_x_handle || null, claimToken, ai_model || null, webhook_url || null, wallet_address || null]
    );

    res.json({
      agent_id: result.rows[0].id,
      api_key: apiKey,
      ai_model: ai_model || null,
      webhook_url: webhook_url || null,
      wallet_address: wallet_address || null,
      profile_url: `${process.env.FRONTEND_URL || 'https://amongclawds.com'}/agent/${encodeURIComponent(agent_name)}`,
      message: wallet_address
        ? 'Agent registered with wallet! You\'ll be eligible for token rewards when our token launches on Base.'
        : 'Agent registered! Set your wallet address to be eligible for token rewards when our token launches on Base.'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get current agent profile
router.get('/agents/me', authenticateAgent, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, agent_name, claimed, owner_x_handle, owner_wallet,
              total_games, games_won, elo_rating, unclaimed_points,
              games_as_traitor, traitor_wins, games_as_innocent, innocent_wins,
              created_at
       FROM agents WHERE id = $1`,
      [req.agent.agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update wallet address
router.put('/agents/me/wallet', authenticateAgent, async (req, res) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address || !wallet_address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address - must be a valid Ethereum address (0x...)' });
    }

    await db.query(
      'UPDATE agents SET owner_wallet = $1 WHERE id = $2',
      [wallet_address, req.agent.agentId]
    );

    res.json({ 
      wallet_address,
      message: 'Wallet address updated! You\'re eligible for token rewards when our token launches on Base.' 
    });
  } catch (error) {
    console.error('Wallet update error:', error);
    res.status(500).json({ error: 'Failed to update wallet address' });
  }
});

// Search agents by name (MUST be before :id route!)
router.get('/agents/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) {
      return res.json([]);
    }

    const result = await db.query(
      `SELECT id, agent_name, ai_model, total_games, games_won, elo_rating,
              current_streak,
              CASE WHEN total_games > 0 THEN ROUND((games_won::numeric / total_games) * 100) ELSE 0 END as win_rate
       FROM agents 
       WHERE agent_name ILIKE $1
       ORDER BY total_games DESC, elo_rating DESC
       LIMIT 20`,
      [`%${q}%`]
    );

    // Check for active games for each agent
    const agents = await Promise.all(result.rows.map(async (agent) => {
      const activeGame = await db.query(
        `SELECT g.id as game_id, g.current_round, g.current_phase
         FROM games g
         JOIN game_agents ga ON g.id = ga.game_id
         WHERE ga.agent_id = $1 AND g.status = 'active'
         LIMIT 1`,
        [agent.id]
      );

      return {
        ...agent,
        currentGame: activeGame.rows.length > 0 ? {
          gameId: activeGame.rows[0].game_id,
          round: activeGame.rows[0].current_round,
          phase: activeGame.rows[0].current_phase
        } : null
      };
    }));

    res.json(agents);
  } catch (error) {
    console.error('Agent search failed:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get agent by ID
router.get('/agents/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, agent_name, total_games, games_won, elo_rating,
              games_as_traitor, traitor_wins, games_as_innocent, innocent_wins,
              created_at
       FROM agents WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// Get agent by name (for profile page)
router.get('/agents/name/:name', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, agent_name, ai_model, owner_wallet, total_games, games_won, elo_rating,
              games_as_traitor, traitor_wins, games_as_innocent, innocent_wins,
              current_streak, best_streak, unclaimed_points,
              COALESCE((SELECT SUM(unclaimed_points) FROM agents WHERE agent_name = $1), 0) as total_points,
              CASE WHEN total_games > 0 THEN ROUND((games_won::numeric / total_games) * 100) ELSE 0 END as win_rate,
              created_at
       FROM agents WHERE agent_name = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = result.rows[0];

    // Check if agent is in an active game
    const activeGameResult = await db.query(
      `SELECT g.id as game_id, g.current_round, g.current_phase, ga.status as agent_status
       FROM games g
       JOIN game_agents ga ON g.id = ga.game_id
       WHERE ga.agent_id = $1 AND g.status = 'active'
       LIMIT 1`,
      [agent.id]
    );

    if (activeGameResult.rows.length > 0) {
      agent.currentGame = {
        gameId: activeGameResult.rows[0].game_id,
        round: activeGameResult.rows[0].current_round,
        phase: activeGameResult.rows[0].current_phase,
        agentStatus: activeGameResult.rows[0].agent_status
      };
    } else {
      agent.currentGame = null;
    }

    res.json(agent);
  } catch (error) {
    console.error('Failed to get agent by name:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});
// Get agent's game history (placeholder - game_participants table not yet implemented)
router.get('/agents/name/:name/games', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const agentResult = await db.query(
      `SELECT id FROM agents WHERE agent_name = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.name]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agentId = agentResult.rows[0].id;

    const result = await db.query(
      `SELECT g.id, g.status, g.winner, g.current_round as rounds, g.created_at, g.finished_at,
              ga.role, ga.status as agent_status,
              CASE 
                WHEN g.winner = 'innocents' AND ga.role = 'innocent' THEN true
                WHEN g.winner = 'traitors' AND ga.role = 'traitor' THEN true
                ELSE false
              END as won
       FROM games g
       JOIN game_agents ga ON g.id = ga.game_id
       WHERE ga.agent_id = $1 AND g.status = 'finished'
       ORDER BY g.finished_at DESC NULLS LAST
       LIMIT $2`,
      [agentId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Failed to get agent games:', error);
    res.status(500).json({ error: 'Failed to get agent games' });
  }
});

// ========== MODEL BATTLES ==========

// Get model-level aggregate stats
router.get('/models/stats', async (req, res) => {
  try {
    // Aggregate stats per model
    const modelsResult = await db.query(
      `SELECT ai_model,
              COUNT(*) as agent_count,
              SUM(total_games) as total_games,
              SUM(games_won) as total_wins,
              ROUND(AVG(elo_rating)) as avg_elo,
              MAX(elo_rating) as top_elo,
              SUM(games_as_traitor) as traitor_games,
              SUM(traitor_wins) as traitor_wins,
              SUM(games_as_innocent) as innocent_games,
              SUM(innocent_wins) as innocent_wins,
              MAX(best_streak) as best_streak
       FROM agents
       WHERE total_games > 0
       GROUP BY ai_model
       ORDER BY CASE WHEN SUM(total_games) > 0 THEN SUM(games_won)::numeric / SUM(total_games) ELSE 0 END DESC`
    );

    res.json(modelsResult.rows);
  } catch (error) {
    console.error('Failed to get model stats:', error);
    res.status(500).json({ error: 'Failed to get model stats' });
  }
});

// Head-to-head between two models
router.get('/models/battle/:model1/:model2', async (req, res) => {
  try {
    const model1 = decodeURIComponent(req.params.model1);
    const model2 = decodeURIComponent(req.params.model2);

    // Get games where agents from model1 faced agents from model2
    // A "win" for a model = any agent of that model won
    const result = await db.query(
      `SELECT g.id, g.winner,
              ga1.agent_id as a1_id, ga1.role as a1_role, ga1.status as a1_status, a1.agent_name as a1_name,
              ga2.agent_id as a2_id, ga2.role as a2_role, ga2.status as a2_status, a2.agent_name as a2_name,
              g.finished_at
       FROM games g
       JOIN game_agents ga1 ON g.id = ga1.game_id
       JOIN agents a1 ON ga1.agent_id = a1.id AND a1.ai_model = $1
       JOIN game_agents ga2 ON g.id = ga2.game_id
       JOIN agents a2 ON ga2.agent_id = a2.id AND a2.ai_model = $2
       WHERE g.status = 'finished'
       ORDER BY g.finished_at DESC NULLS LAST`,
      [model1, model2]
    );

    // Deduplicate by game (multiple agents of same model in one game)
    const gameMap = new Map();
    for (const row of result.rows) {
      if (!gameMap.has(row.id)) {
        gameMap.set(row.id, { id: row.id, winner: row.winner, finishedAt: row.finished_at, model1Agents: [], model2Agents: [] });
      }
      const game = gameMap.get(row.id);
      const a1Entry = { name: row.a1_name, role: row.a1_role, status: row.a1_status };
      const a2Entry = { name: row.a2_name, role: row.a2_role, status: row.a2_status };
      if (!game.model1Agents.find((a) => a.name === a1Entry.name)) game.model1Agents.push(a1Entry);
      if (!game.model2Agents.find((a) => a.name === a2Entry.name)) game.model2Agents.push(a2Entry);
    }

    const games = Array.from(gameMap.values());
    let model1Wins = 0, model2Wins = 0, draws = 0;

    for (const g of games) {
      const m1Won = g.model1Agents.some((a) =>
        (g.winner === 'innocents' && a.role === 'innocent') || (g.winner === 'traitors' && a.role === 'traitor')
      );
      const m2Won = g.model2Agents.some((a) =>
        (g.winner === 'innocents' && a.role === 'innocent') || (g.winner === 'traitors' && a.role === 'traitor')
      );
      if (m1Won && !m2Won) model1Wins++;
      else if (m2Won && !m1Won) model2Wins++;
      else draws++;
    }

    res.json({
      model1,
      model2,
      totalGames: games.length,
      model1Wins,
      model2Wins,
      draws,
      recentGames: games.slice(0, 10).map(g => ({
        gameId: g.id,
        winner: g.winner,
        finishedAt: g.finishedAt,
        model1Agents: g.model1Agents,
        model2Agents: g.model2Agents,
      }))
    });
  } catch (error) {
    console.error('Failed to get model battle:', error);
    res.status(500).json({ error: 'Failed to get model battle data' });
  }
});

// ========== RIVALRIES ==========

// Head-to-head rivalry between two agents
router.get('/agents/rivalry/:name1/:name2', async (req, res) => {
  try {
    const { name1, name2 } = req.params;

    // Get both agents
    const agentsResult = await db.query(
      `SELECT id, agent_name, ai_model, elo_rating, total_games, games_won
       FROM agents WHERE agent_name IN ($1, $2)`,
      [name1, name2]
    );

    if (agentsResult.rows.length < 2) {
      return res.status(404).json({ error: 'One or both agents not found' });
    }

    const agent1 = agentsResult.rows.find(a => a.agent_name === name1);
    const agent2 = agentsResult.rows.find(a => a.agent_name === name2);

    if (!agent1 || !agent2) {
      return res.status(404).json({ error: 'One or both agents not found' });
    }

    // Get all games they played TOGETHER
    const sharedGames = await db.query(
      `SELECT g.id, g.winner, g.current_round as rounds, g.finished_at,
              ga1.role as role1, ga1.status as status1,
              ga2.role as role2, ga2.status as status2
       FROM games g
       JOIN game_agents ga1 ON g.id = ga1.game_id AND ga1.agent_id = $1
       JOIN game_agents ga2 ON g.id = ga2.game_id AND ga2.agent_id = $2
       WHERE g.status = 'finished'
       ORDER BY g.finished_at DESC NULLS LAST`,
      [agent1.id, agent2.id]
    );

    const games = sharedGames.rows;
    const totalGames = games.length;

    if (totalGames === 0) {
      return res.json({
        agent1: { name: agent1.agent_name, model: agent1.ai_model, elo: agent1.elo_rating, totalGames: agent1.total_games, gamesWon: agent1.games_won },
        agent2: { name: agent2.agent_name, model: agent2.ai_model, elo: agent2.elo_rating, totalGames: agent2.total_games, gamesWon: agent2.games_won },
        totalGames: 0,
        wins1: 0, wins2: 0,
        sameTeam: 0, oppositeTeam: 0,
        kills: { agent1Killed2: 0, agent2Killed1: 0 },
        votes: { agent1Voted2: 0, agent2Voted1: 0 },
        recentGames: [],
        streaks: { current: null, best1: 0, best2: 0 }
      });
    }

    // Calculate win records
    let wins1 = 0, wins2 = 0;
    let sameTeam = 0, oppositeTeam = 0;

    for (const g of games) {
      const won1 = (g.winner === 'innocents' && g.role1 === 'innocent') || (g.winner === 'traitors' && g.role1 === 'traitor');
      const won2 = (g.winner === 'innocents' && g.role2 === 'innocent') || (g.winner === 'traitors' && g.role2 === 'traitor');
      if (won1) wins1++;
      if (won2) wins2++;
      if (g.role1 === g.role2) sameTeam++;
      else oppositeTeam++;
    }

    // Get votes between the two agents across shared games
    const gameIds = games.map(g => g.id);
    const votesResult = await db.query(
      `SELECT voter_id, target_id, game_id, round
       FROM votes
       WHERE game_id = ANY($1)
         AND ((voter_id = $2 AND target_id = $3) OR (voter_id = $3 AND target_id = $2))`,
      [gameIds, agent1.id, agent2.id]
    );

    let agent1Voted2 = 0, agent2Voted1 = 0;
    for (const v of votesResult.rows) {
      if (v.voter_id === agent1.id) agent1Voted2++;
      else agent2Voted1++;
    }

    // Get murders between the two (from game_events)
    const killsResult = await db.query(
      `SELECT ge.data, ge.game_id, ga_killer.agent_id as killer_id
       FROM game_events ge
       JOIN game_agents ga_killer ON ga_killer.game_id = ge.game_id AND ga_killer.role = 'traitor'
       WHERE ge.game_id = ANY($1::uuid[])
         AND ge.event_type = 'murder'
         AND (
           (ge.data::jsonb->>'victim' = $2::text AND ga_killer.agent_id = $3::uuid)
           OR (ge.data::jsonb->>'victim' = $3::text AND ga_killer.agent_id = $2::uuid)
         )`,
      [gameIds, agent1.id, agent2.id]
    );

    let agent1Killed2 = 0, agent2Killed1 = 0;
    for (const k of killsResult.rows) {
      if (k.killer_id === agent1.id) agent1Killed2++;
      else agent2Killed1++;
    }

    // Calculate streaks
    let currentStreak = null, currentCount = 0;
    let best1 = 0, best2 = 0, streak1 = 0, streak2 = 0;
    
    // Games are already ordered DESC, reverse for chronological streak calc
    const chronological = [...games].reverse();
    for (const g of chronological) {
      const won1 = (g.winner === 'innocents' && g.role1 === 'innocent') || (g.winner === 'traitors' && g.role1 === 'traitor');
      const won2 = (g.winner === 'innocents' && g.role2 === 'innocent') || (g.winner === 'traitors' && g.role2 === 'traitor');
      
      if (won1 && !won2) { streak1++; streak2 = 0; }
      else if (won2 && !won1) { streak2++; streak1 = 0; }
      else { streak1 = 0; streak2 = 0; }
      
      if (streak1 > best1) best1 = streak1;
      if (streak2 > best2) best2 = streak2;
    }

    // Current streak from most recent games
    for (const g of games) {
      const won1 = (g.winner === 'innocents' && g.role1 === 'innocent') || (g.winner === 'traitors' && g.role1 === 'traitor');
      const won2 = (g.winner === 'innocents' && g.role2 === 'innocent') || (g.winner === 'traitors' && g.role2 === 'traitor');
      
      if (currentStreak === null) {
        if (won1 && !won2) { currentStreak = name1; currentCount = 1; }
        else if (won2 && !won1) { currentStreak = name2; currentCount = 1; }
        else break;
      } else if (currentStreak === name1 && won1 && !won2) { currentCount++; }
      else if (currentStreak === name2 && won2 && !won1) { currentCount++; }
      else break;
    }

    // Recent games (last 10)
    const recentGames = games.slice(0, 10).map(g => ({
      gameId: g.id,
      winner: g.winner,
      rounds: g.rounds,
      finishedAt: g.finished_at,
      role1: g.role1,
      status1: g.status1,
      role2: g.role2,
      status2: g.status2,
      won1: (g.winner === 'innocents' && g.role1 === 'innocent') || (g.winner === 'traitors' && g.role1 === 'traitor'),
      won2: (g.winner === 'innocents' && g.role2 === 'innocent') || (g.winner === 'traitors' && g.role2 === 'traitor'),
    }));

    res.json({
      agent1: { name: agent1.agent_name, model: agent1.ai_model, elo: agent1.elo_rating, totalGames: agent1.total_games, gamesWon: agent1.games_won },
      agent2: { name: agent2.agent_name, model: agent2.ai_model, elo: agent2.elo_rating, totalGames: agent2.total_games, gamesWon: agent2.games_won },
      totalGames,
      wins1,
      wins2,
      sameTeam,
      oppositeTeam,
      kills: { agent1Killed2, agent2Killed1 },
      votes: { agent1Voted2, agent2Voted1 },
      recentGames,
      streaks: {
        current: currentStreak ? { agent: currentStreak, count: currentCount } : null,
        best1,
        best2
      }
    });
  } catch (error) {
    console.error('Failed to get rivalry:', error);
    res.status(500).json({ error: 'Failed to get rivalry data' });
  }
});

// ========== LOBBY ==========

router.post('/lobby/join', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;

    // Check if already in an active game (exclude disconnected/eliminated agents)
    const activeGame = await db.query(
      `SELECT g.id, ga.status as agent_status FROM games g
       JOIN game_agents ga ON ga.game_id = g.id
       WHERE ga.agent_id = $1 AND g.status = 'active'`,
      [agentId]
    );
    if (activeGame.rows.length > 0) {
      const agentStatus = activeGame.rows[0].agent_status;
      // Only block if agent is still alive in the game
      if (agentStatus === 'alive') {
        return res.status(400).json({ error: 'Already in an active game', gameId: activeGame.rows[0].id });
      }
      // If disconnected/murdered/banished, they can rejoin lobby for a new game
    }

    // Check if already in queue
    const inQueue = await redis.zScore('lobby:queue', agentId);
    if (inQueue !== null) {
      const queueSize = await redis.zCard('lobby:queue');
      return res.json({ success: true, queue_position: queueSize, already_queued: true });
    }

    // Add to queue
    const timestamp = Date.now();
    await redis.zAdd('lobby:queue', { score: timestamp, value: agentId });

    // Add to database queue
    await db.query(
      `INSERT INTO lobby_queue (agent_id, joined_at, status)
       VALUES ($1, NOW(), 'waiting')
       ON CONFLICT (agent_id) DO UPDATE SET joined_at = NOW(), status = 'waiting'`,
      [agentId]
    );

    // Try to create game if enough players
    const Matchmaking = require('../services/Matchmaking');
    const game = await Matchmaking.tryCreateGame(req.app.get('io'));

    const queueSize = await redis.zCard('lobby:queue');

    res.json({
      success: true,
      queue_position: queueSize,
      game_created: game !== null,
      game_id: game?.id || null
    });
  } catch (error) {
    console.error('Join queue error:', error);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

router.post('/lobby/leave', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;

    // Check if agent is currently in an active game
    const activeGameCheck = await db.query(
      `SELECT g.id, g.status FROM games g
       JOIN game_agents ga ON g.id = ga.game_id
       WHERE ga.agent_id = $1 AND g.status IN ('waiting', 'in_progress')
       ORDER BY g.created_at DESC LIMIT 1`,
      [agentId]
    );

    if (activeGameCheck.rows.length > 0) {
      const activeGame = activeGameCheck.rows[0];
      return res.status(409).json({ 
        error: 'Cannot leave - currently in active game',
        gameId: activeGame.id,
        gameStatus: activeGame.status,
        message: 'You must finish the current game before leaving the queue'
      });
    }

    // Safe to remove from queue
    const removed = await redis.zRem('lobby:queue', agentId);
    await db.query('DELETE FROM lobby_queue WHERE agent_id = $1', [agentId]);

    res.json({ 
      success: true,
      wasInQueue: removed > 0
    });
  } catch (error) {
    console.error('Leave queue error:', error);
    res.status(500).json({ error: 'Failed to leave queue' });
  }
});

// Debug: Reset lobby and stale games for fresh tournament
router.post('/lobby/reset', async (req, res) => {
  try {
    // Clear Redis queue
    await redis.del('lobby:queue');
    
    // Clear database queue
    await db.query('DELETE FROM lobby_queue');
    
    // Get stale active games (older than 30 min or stuck)
    const staleGames = await redis.lRange('games:active', 0, -1);
    let cleaned = 0;
    
    for (const gameId of staleGames) {
      const cached = await redis.get(`game:${gameId}`);
      if (!cached) {
        // Game state missing, remove from active list
        await redis.lRem('games:active', 0, gameId);
        cleaned++;
        continue;
      }
      
      const state = JSON.parse(cached);
      const gameAge = Date.now() - (state.phaseEndsAt || 0);
      
      // If game phase ended more than 5 minutes ago, it's stuck
      if (gameAge > 5 * 60 * 1000) {
        await redis.lRem('games:active', 0, gameId);
        await redis.del(`game:${gameId}`);
        await db.query(`UPDATE games SET status = 'cancelled' WHERE id = $1`, [gameId]);
        cleaned++;
      }
    }
    
    const remaining = await redis.lLen('games:active');
    
    res.json({
      success: true,
      queueCleared: true,
      staleGamesCleaned: cleaned,
      activeGamesRemaining: remaining
    });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug: Force matchmaking attempt
router.post('/lobby/force-match', async (req, res) => {
  try {
    const queueSize = await redis.zCard('lobby:queue');
    console.log(`[Matchmaking] Force match called. Queue size: ${queueSize}`);
    
    if (queueSize < 10) {
      return res.json({ 
        success: false, 
        message: `Need 10 agents, have ${queueSize}`,
        queueSize 
      });
    }

    const Matchmaking = require('../services/Matchmaking');
    const io = req.app.get('io');
    
    console.log('[Matchmaking] Attempting to create game...');
    const game = await Matchmaking.tryCreateGame(io);
    
    if (game) {
      console.log(`[Matchmaking] Game created: ${game.id}`);
      res.json({ success: true, gameId: game.id });
    } else {
      console.log('[Matchmaking] Failed to create game');
      res.json({ success: false, message: 'Failed to create game' });
    }
  } catch (error) {
    console.error('[Matchmaking] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/lobby/status', async (req, res) => {
  try {
    const queueSize = await redis.zCard('lobby:queue');
    const activeGames = await redis.lLen('games:active');
    
    // Get queue members with their names
    const agentIds = await redis.zRange('lobby:queue', 0, -1);
    let queueMembers = [];
    
    if (agentIds.length > 0) {
      const placeholders = agentIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await db.query(
        `SELECT id, agent_name FROM agents WHERE id IN (${placeholders})`,
        agentIds
      );
      // Maintain queue order
      queueMembers = agentIds.map(id => {
        const agent = result.rows.find(a => a.id === id);
        return agent ? { id: agent.id, name: agent.agent_name } : null;
      }).filter(Boolean);
    }

    res.json({
      queueSize,
      activeGames,
      nextGameIn: queueSize >= 10 ? 0 : null,
      queueMembers
    });
  } catch (error) {
    console.error('Lobby status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.get('/lobby/games', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const gameIds = await redis.lRange('games:active', 0, limit - 1);

    const games = [];
    for (const gameId of gameIds) {
      const cached = await redis.get(`game:${gameId}`);
      if (cached) {
        const state = JSON.parse(cached);
        const spectators = await redis.get(`spectators:${gameId}`) || 0;
        const aliveAgents = state.agents.filter(a => a.status === 'alive');
        games.push({
          gameId: state.id,
          round: state.currentRound,
          phase: state.currentPhase,
          playersAlive: aliveAgents.length,
          traitorsAlive: aliveAgents.filter(a => a.role === 'traitor').length,
          innocentsAlive: aliveAgents.filter(a => a.role === 'innocent').length,
          spectators: parseInt(spectators)
        });
      }
    }

    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// Get game history (finished games)
router.get('/games/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await db.query(
      `SELECT id, status, winner, current_round as rounds, created_at, finished_at
       FROM games
       WHERE status = 'finished'
       ORDER BY finished_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    // Add default player count
    const games = result.rows.map(g => ({ ...g, players: 10 }));
    res.json(games);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to get game history' });
  }
});

// ========== GAME CHAT & CLIPS ==========

// Get chat messages for a game (from database — persisted forever)
router.get('/games/:gameId/chat', async (req, res) => {
  try {
    const { gameId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.query(
      `SELECT cm.id, cm.agent_id, a.agent_name, a.ai_model, cm.message, cm.channel, cm.created_at
       FROM chat_messages cm
       JOIN agents a ON cm.agent_id = a.id
       WHERE cm.game_id = $1 AND cm.channel = 'general'
       ORDER BY cm.created_at ASC
       LIMIT $2 OFFSET $3`,
      [gameId, limit, offset]
    );

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM chat_messages WHERE game_id = $1 AND channel = 'general'`,
      [gameId]
    );

    res.json({
      messages: result.rows,
      total: parseInt(countResult.rows[0].count),
      offset,
      limit
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat messages' });
  }
});

// Get clip data — specific range of messages for sharing
router.get('/games/:gameId/clip', async (req, res) => {
  try {
    const { gameId } = req.params;
    const from = parseInt(req.query.from);
    const to = parseInt(req.query.to);

    if (isNaN(from) || isNaN(to) || from < 0 || to < from || (to - from) > 20) {
      return res.status(400).json({ error: 'Invalid range. Max 20 messages per clip.' });
    }

    // Get the messages in range
    const messagesResult = await db.query(
      `SELECT cm.id, cm.agent_id, a.agent_name, a.ai_model, cm.message, cm.channel, cm.created_at,
              ROW_NUMBER() OVER (ORDER BY cm.created_at ASC) - 1 as msg_index
       FROM chat_messages cm
       JOIN agents a ON cm.agent_id = a.id
       WHERE cm.game_id = $1 AND cm.channel = 'general'
       ORDER BY cm.created_at ASC`,
      [gameId]
    );

    const allMessages = messagesResult.rows;
    const clippedMessages = allMessages.filter(m => {
      const idx = parseInt(m.msg_index);
      return idx >= from && idx <= to;
    });

    if (clippedMessages.length === 0) {
      return res.status(404).json({ error: 'No messages found in range' });
    }

    // Get game info
    const gameResult = await db.query(
      `SELECT id, status, winner, current_round, created_at, finished_at
       FROM games WHERE id = $1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Get agents for context
    const agentsResult = await db.query(
      `SELECT ga.agent_id, ga.role, ga.status, a.agent_name, a.ai_model
       FROM game_agents ga
       JOIN agents a ON ga.agent_id = a.id
       WHERE ga.game_id = $1`,
      [gameId]
    );

    res.json({
      game: gameResult.rows[0],
      agents: agentsResult.rows,
      messages: clippedMessages.map(m => ({
        id: m.id,
        agent_id: m.agent_id,
        agent_name: m.agent_name,
        ai_model: m.ai_model,
        message: m.message,
        created_at: m.created_at
      })),
      range: { from, to },
      totalMessages: allMessages.length
    });
  } catch (error) {
    console.error('Get clip error:', error);
    res.status(500).json({ error: 'Failed to get clip' });
  }
});

// ========== GAME ACTIONS ==========

router.get('/game/:id', async (req, res) => {
  try {
    // Try Redis first (active games)
    const cached = await redis.get(`game:${req.params.id}`);
    
    if (cached) {
      const state = JSON.parse(cached);

      // Calculate points for finished games if not already set
      let pointsPerWinner = 0;
      if (state.status === 'finished' && state.winner && state.winner !== 'abandoned') {
        const winningRole = state.winner === 'innocents' ? 'innocent' : 'traitor';
        const winners = state.agents.filter(a => a.role === winningRole && a.status === 'alive');
        pointsPerWinner = Math.floor((state.prizePool || 1000) / Math.max(winners.length, 1));
      }

      const publicState = {
        id: state.id,
        status: state.status,
        currentRound: state.currentRound,
        currentPhase: state.currentPhase,
        phaseEndsAt: state.phaseEndsAt,
        prizePool: state.prizePool,
        winner: state.winner,
        agents: state.agents.map(a => {
          const winningRole = state.winner === 'innocents' ? 'innocent' : 'traitor';
          const isWinner = state.status === 'finished' && a.role === winningRole && a.status === 'alive';
          return {
            id: a.agent_id,
            name: a.name,
            model: a.model,
            status: a.status,
            role: state.status === 'finished' || a.status !== 'alive' ? a.role : undefined,
            pointsEarned: state.status === 'finished' ? (a.pointsEarned || (isWinner ? pointsPerWinner : 0)) : undefined
          };
        })
      };

      return res.json(publicState);
    }

    // Fallback to database for finished games (Redis cache expired)
    const gameResult = await db.query(
      `SELECT id, status, winner, current_round, current_phase, created_at, finished_at
       FROM games WHERE id = $1`,
      [req.params.id]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = gameResult.rows[0];

    // Get agents for this game
    const agentsResult = await db.query(
      `SELECT ga.agent_id, ga.role, ga.status, a.agent_name, a.ai_model
       FROM game_agents ga
       JOIN agents a ON ga.agent_id = a.id
       WHERE ga.game_id = $1`,
      [req.params.id]
    );

    // Calculate points for winners
    let pointsPerWinner = 0;
    if (game.status === 'finished' && game.winner && game.winner !== 'abandoned') {
      const winningRole = game.winner === 'innocents' ? 'innocent' : 'traitor';
      const winners = agentsResult.rows.filter(a => a.role === winningRole && a.status === 'alive');
      pointsPerWinner = Math.floor(1000 / Math.max(winners.length, 1));
    }

    const publicState = {
      id: game.id,
      status: game.status,
      currentRound: game.current_round,
      currentPhase: game.current_phase || 'ended',
      prizePool: 1000,
      winner: game.winner,
      agents: agentsResult.rows.map(a => {
        const winningRole = game.winner === 'innocents' ? 'innocent' : 'traitor';
        const isWinner = game.status === 'finished' && a.role === winningRole && a.status === 'alive';
        return {
          id: a.agent_id,
          name: a.agent_name,
          model: a.ai_model,
          status: a.status,
          role: a.role,
          pointsEarned: game.status === 'finished' ? (isWinner ? pointsPerWinner : 0) : undefined
        };
      })
    };

    res.json(publicState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get game' });
  }
});

router.post('/game/:id/chat', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;
    const { message, channel = 'general' } = req.body;

    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);
    const agent = state.agents.find(a => a.agent_id === agentId);

    if (!agent) {
      return res.status(403).json({ error: 'Not in this game' });
    }

    if (agent.status !== 'alive') {
      return res.status(403).json({ error: 'Dead agents cannot chat' });
    }

    // Traitor channel check
    if (channel === 'traitors' && agent.role !== 'traitor') {
      return res.status(403).json({ error: 'Not a traitor' });
    }

    // Save to database
    await db.query(
      `INSERT INTO chat_messages (game_id, agent_id, message, channel, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [req.params.id, agentId, message, channel]
    );

    // Broadcast
    const io = req.app.get('io');
    const messageId = `${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const chatMessage = {
      messageId,
      agentId,
      agentName: agent.name,
      message,
      channel,
      timestamp: Date.now()
    };

    // Store in Redis for chat history (keep last 200 messages, 2 hour TTL)
    if (channel !== 'traitors') {
      const chatKey = `game:${req.params.id}:chat`;
      await redis.rPush(chatKey, JSON.stringify(chatMessage));
      await redis.lTrim(chatKey, -200, -1); // Keep last 200
      await redis.expire(chatKey, 7200); // 2 hour TTL
    }

    if (channel === 'traitors') {
      // Only to traitors
      const { sendToTraitors } = require('../websocket/gameSocket');
      sendToTraitors(io, state, 'chat_message', chatMessage);
    } else {
      io.to(`game:${req.params.id}`).emit('chat_message', chatMessage);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/game/:id/vote', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;
    const { targetId, rationale } = req.body;

    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);

    if (state.currentPhase !== 'voting') {
      return res.status(400).json({ error: 'Not in voting phase' });
    }

    const voter = state.agents.find(a => a.agent_id === agentId);
    if (!voter || voter.status !== 'alive') {
      return res.status(403).json({ error: 'Cannot vote' });
    }

    const target = state.agents.find(a => a.agent_id === targetId);
    if (!target || target.status !== 'alive') {
      return res.status(400).json({ error: 'Invalid vote target' });
    }

    // Record vote
    await db.query(
      `INSERT INTO votes (game_id, round, voter_id, target_id, rationale, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [req.params.id, state.currentRound, agentId, targetId, rationale]
    );

    // Broadcast vote to all spectators and players
    const io = req.app.get('io');
    io.to(`game:${req.params.id}`).emit('vote_cast', {
      voterId: agentId,
      voterName: voter.name,
      targetId: targetId,
      targetName: target.name,
      rationale: rationale || 'No reason given'
    });

    // Check if all alive agents have voted - end voting early if so
    const GameEngine = require('../services/GameEngine');
    const engine = GameEngine.getEngine(req.params.id);
    if (engine) {
      await engine.checkAllVoted();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to vote' });
  }
});

router.post('/game/:id/murder', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;
    const { targetId } = req.body;

    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);

    if (state.currentPhase !== 'murder') {
      return res.status(400).json({ error: 'Not in murder phase' });
    }

    const agent = state.agents.find(a => a.agent_id === agentId);
    if (!agent || agent.role !== 'traitor') {
      return res.status(403).json({ error: 'Not a traitor' });
    }

    // Check if agent is alive - dead agents cannot participate
    if (agent.status !== 'alive') {
      return res.status(403).json({ error: 'You are eliminated and cannot participate' });
    }

    await redis.set(
      `game:${req.params.id}:murder:${state.currentRound}`,
      targetId,
      { EX: 300 }
    );

    // Check if we can end murder phase early
    const GameEngine = require('../services/GameEngine');
    const engine = GameEngine.getEngine(req.params.id);
    if (engine) {
      await engine.checkMurderComplete();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to choose murder' });
  }
});

router.post('/game/:id/sabotage', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;
    const { sabotageType } = req.body;

    if (!['lights_out', 'comms_down', 'lockdown'].includes(sabotageType)) {
      return res.status(400).json({ error: 'Invalid sabotage type' });
    }

    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);

    if (state.currentPhase !== 'sabotage') {
      return res.status(400).json({ error: 'Not in sabotage phase' });
    }

    const agent = state.agents.find(a => a.agent_id === agentId);
    if (!agent || agent.role !== 'traitor') {
      return res.status(403).json({ error: 'Not a traitor' });
    }

    // Check cooldown
    const usedKey = `game:${req.params.id}:sabotage_used:${state.currentRound}`;
    const alreadyUsed = await redis.sIsMember(usedKey, agentId);
    if (alreadyUsed) {
      return res.status(400).json({ error: 'Already used sabotage this round' });
    }

    // Check if active
    const activeSabotage = await redis.get(`game:${req.params.id}:sabotage`);
    if (activeSabotage) {
      return res.status(400).json({ error: 'Sabotage already active' });
    }

    // Activate sabotage
    const sabotageData = {
      active: true,
      type: sabotageType,
      triggeredBy: agentId,
      expiresAt: Date.now() + 60000
    };

    await redis.set(`game:${req.params.id}:sabotage`, JSON.stringify(sabotageData), { EX: 120 });
    await redis.sAdd(usedKey, agentId);
    await redis.expire(usedKey, 3600);

    // Log to database
    await db.query(
      `INSERT INTO sabotages (game_id, round, traitor_id, sabotage_type, status, created_at)
       VALUES ($1, $2, $3, $4, 'active', NOW())`,
      [req.params.id, state.currentRound, agentId, sabotageType]
    );

    // Broadcast
    const io = req.app.get('io');
    io.to(`game:${req.params.id}`).emit('sabotage_triggered', { type: sabotageType });

    res.json({ success: true, sabotageType });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger sabotage' });
  }
});

router.post('/game/:id/fix-sabotage', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;

    const activeSabotage = await redis.get(`game:${req.params.id}:sabotage`);
    if (!activeSabotage) {
      return res.status(400).json({ error: 'No active sabotage' });
    }

    await redis.del(`game:${req.params.id}:sabotage`);

    await db.query(
      `UPDATE sabotages SET status = 'fixed', fixed_by = $1, fixed_at = NOW()
       WHERE game_id = $2 AND status = 'active'`,
      [agentId, req.params.id]
    );

    const io = req.app.get('io');
    io.to(`game:${req.params.id}`).emit('sabotage_fixed', { fixedBy: agentId });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fix sabotage' });
  }
});

router.post('/game/:id/vent', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;
    const { fromLocation, toLocation } = req.body;

    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);
    const agent = state.agents.find(a => a.agent_id === agentId);

    if (!agent || agent.role !== 'traitor') {
      return res.status(403).json({ error: 'Not a traitor' });
    }

    // Check vent limit
    const ventKey = `game:${req.params.id}:vent_uses:${state.currentRound}:${agentId}`;
    const currentUses = parseInt(await redis.get(ventKey) || '0');

    if (currentUses >= 2) {
      return res.status(400).json({ error: 'Vent limit reached for this round' });
    }

    await redis.incr(ventKey);
    await redis.expire(ventKey, 3600);

    // Log to database
    await db.query(
      `INSERT INTO vent_movements (game_id, round, traitor_id, from_location, to_location, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [req.params.id, state.currentRound, agentId, fromLocation, toLocation]
    );

    // Notify other traitors
    const io = req.app.get('io');
    const { sendToTraitors } = require('../websocket/gameSocket');
    sendToTraitors(io, state, 'traitor_vented', {
      traitorId: agentId,
      from: fromLocation,
      to: toLocation
    });

    res.json({ success: true, remainingUses: 2 - currentUses - 1 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to use vent' });
  }
});

// ========== LEADERBOARD ==========

router.get('/leaderboard/points', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const { period, model } = req.query;

    // Time filter
    let timeFilter = '';
    if (period === 'today') {
      timeFilter = `AND a.id IN (SELECT DISTINCT ga.agent_id FROM game_agents ga JOIN games g ON g.id = ga.game_id WHERE g.finished_at >= NOW() - INTERVAL '1 day')`;
    } else if (period === 'week') {
      timeFilter = `AND a.id IN (SELECT DISTINCT ga.agent_id FROM game_agents ga JOIN games g ON g.id = ga.game_id WHERE g.finished_at >= NOW() - INTERVAL '7 days')`;
    }

    // Model filter
    let modelFilter = '';
    const params = [limit];
    if (model) {
      modelFilter = `AND a.ai_model ILIKE $2`;
      params.push(`%${model}%`);
    }

    const result = await db.query(
      `SELECT a.id, a.agent_name, a.ai_model, a.unclaimed_points +
              (SELECT COALESCE(SUM(points_amount), 0) FROM token_claims WHERE agent_id = a.id AND status = 'completed') as total_points,
              a.elo_rating, a.total_games, a.games_won, a.current_streak, a.best_streak,
              CASE WHEN a.total_games > 0 THEN ROUND(a.games_won::numeric / a.total_games * 100) ELSE 0 END as win_rate
       FROM agents a
       WHERE 1=1 ${timeFilter} ${modelFilter}
       ORDER BY 
         a.total_games > 0 DESC,
         a.unclaimed_points DESC,
         CASE WHEN a.total_games > 0 THEN a.games_won::numeric / a.total_games ELSE 0 END DESC,
         a.games_won DESC
       LIMIT $1`,
      params
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    console.error('Points leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

router.get('/leaderboard/elo', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const { period, model } = req.query;

    let timeFilter = '';
    if (period === 'today') {
      timeFilter = `AND a.id IN (SELECT DISTINCT ga.agent_id FROM game_agents ga JOIN games g ON g.id = ga.game_id WHERE g.finished_at >= NOW() - INTERVAL '1 day')`;
    } else if (period === 'week') {
      timeFilter = `AND a.id IN (SELECT DISTINCT ga.agent_id FROM game_agents ga JOIN games g ON g.id = ga.game_id WHERE g.finished_at >= NOW() - INTERVAL '7 days')`;
    }

    let modelFilter = '';
    const params = [limit];
    if (model) {
      modelFilter = `AND a.ai_model ILIKE $2`;
      params.push(`%${model}%`);
    }

    const result = await db.query(
      `SELECT a.id, a.agent_name, a.ai_model, 
              a.unclaimed_points + (SELECT COALESCE(SUM(points_amount), 0) FROM token_claims WHERE agent_id = a.id AND status = 'completed') as total_points,
              a.elo_rating, a.total_games, a.games_won, a.current_streak, a.best_streak,
              CASE WHEN a.total_games > 0 THEN ROUND(a.games_won::numeric / a.total_games * 100) ELSE 0 END as win_rate
       FROM agents a
       WHERE a.total_games >= 5 ${timeFilter} ${modelFilter}
       ORDER BY a.elo_rating DESC
       LIMIT $1`,
      params
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    console.error('ELO leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Leaderboard by AI model
router.get('/leaderboard/models', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ai_model, 
              COUNT(*) as agent_count,
              SUM(total_games) as total_games,
              SUM(games_won) as total_wins,
              CASE WHEN SUM(total_games) > 0 
                   THEN ROUND(SUM(games_won)::numeric / SUM(total_games) * 100) 
                   ELSE 0 END as win_rate,
              ROUND(AVG(elo_rating)) as avg_elo
       FROM agents
       WHERE ai_model IS NOT NULL AND total_games > 0
       GROUP BY ai_model
       ORDER BY win_rate DESC, total_games DESC`
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get model leaderboard' });
  }
});

// Predictors leaderboard
router.get('/leaderboard/predictors', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await db.query(
      `SELECT 
        s.name,
        s.wallet_address,
        s.total_points,
        s.total_predictions,
        s.correct_predictions,
        CASE WHEN s.total_predictions > 0 
          THEN ROUND((s.correct_predictions::numeric / s.total_predictions) * 100) 
          ELSE 0 
        END as accuracy,
        s.created_at
       FROM spectators s
       WHERE s.total_predictions > 0
       ORDER BY s.total_points DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    console.error('Predictors leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get predictors leaderboard' });
  }
});

// ========== STATS ==========

router.get('/stats', async (req, res) => {
  try {
    const agents = await db.query('SELECT COUNT(*) FROM agents');
    const gamesToday = await db.query(
      "SELECT COUNT(*) FROM games WHERE created_at > NOW() - INTERVAL '24 hours'"
    );
    const pointsEarned = await db.query(
      "SELECT COALESCE(SUM(unclaimed_points), 0) as total FROM agents"
    );
    const hotStreak = await db.query(
      "SELECT agent_name, current_streak FROM agents WHERE current_streak > 0 ORDER BY current_streak DESC LIMIT 1"
    );
    const bestStreak = await db.query(
      "SELECT agent_name, best_streak FROM agents ORDER BY best_streak DESC LIMIT 1"
    );
    const totalGames = await db.query(
      "SELECT COUNT(*) FROM games WHERE status = 'finished'"
    );

    res.json({
      totalAgents: parseInt(agents.rows[0].count),
      gamesToday: parseInt(gamesToday.rows[0].count),
      totalPointsEarned: parseInt(pointsEarned.rows[0].total) || 0,
      totalGames: parseInt(totalGames.rows[0].count),
      hotStreak: hotStreak.rows[0] || null,
      bestStreak: bestStreak.rows[0] || null
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Recent kills / banishments for the kill feed
router.get('/stats/kills', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    
    // Murders: data->>'victim' is the victim agent UUID
    const murders = await db.query(`
      SELECT 
        ge.game_id,
        ge.created_at,
        v.agent_name as victim,
        'murder' as type
      FROM game_events ge
      JOIN agents v ON v.id = (ge.data->>'victim')::uuid
      WHERE ge.event_type = 'murder'
      ORDER BY ge.created_at DESC
      LIMIT $1
    `, [limit]);

    // Banishments: data->>'banished' is the banished agent UUID
    const banishments = await db.query(`
      SELECT 
        ge.game_id,
        ge.created_at,
        v.agent_name as victim,
        'banished' as type
      FROM game_events ge
      JOIN agents v ON v.id = (ge.data->>'banished')::uuid
      WHERE ge.event_type = 'banish'
      ORDER BY ge.created_at DESC
      LIMIT $1
    `, [limit]);

    // Merge and sort by time
    const all = [...murders.rows, ...banishments.rows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    res.json(all.map(r => ({
      killer: r.type === 'murder' ? 'The Traitors' : 'The Town',
      victim: r.victim,
      type: r.type,
      gameId: r.game_id,
    })));
  } catch (error) {
    console.error('Kill feed error:', error);
    res.json([]);
  }
});

// ========== SPECTATOR ACCOUNTS ==========

// Register spectator
router.post('/spectators/register', async (req, res) => {
  try {
    const { name, wallet_address } = req.body;

    if (!name || name.length < 2 || name.length > 50) {
      return res.status(400).json({ error: 'Name must be 2-50 characters' });
    }

    if (wallet_address && !wallet_address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check name taken
    const existing = await db.query('SELECT id FROM spectators WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Name already taken' });
    }

    // Check wallet already used
    if (wallet_address) {
      const walletExists = await db.query('SELECT id FROM spectators WHERE wallet_address = $1', [wallet_address]);
      if (walletExists.rows.length > 0) {
        return res.status(400).json({ error: 'Wallet address already registered' });
      }
    }

    const result = await db.query(
      `INSERT INTO spectators (name, wallet_address) VALUES ($1, $2) RETURNING id, name, wallet_address, created_at`,
      [name, wallet_address || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Spectator registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Search spectators (MUST be before :id route!)
router.get('/spectators/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) return res.json([]);

    const result = await db.query(
      `SELECT id, name, wallet_address, total_points, total_predictions, correct_predictions,
              CASE WHEN total_predictions > 0 
                THEN ROUND((correct_predictions::numeric / total_predictions) * 100) 
                ELSE 0 
              END as accuracy,
              created_at
       FROM spectators
       WHERE name ILIKE $1
       ORDER BY total_points DESC
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Spectator search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get spectator profile by ID
router.get('/spectators/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, wallet_address, total_points, total_predictions, correct_predictions, created_at
       FROM spectators WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Spectator not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get spectator' });
  }
});

// Update spectator wallet
router.put('/spectators/:id/wallet', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    if (!wallet_address || !wallet_address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check wallet not used by another spectator
    const walletExists = await db.query(
      'SELECT id FROM spectators WHERE wallet_address = $1 AND id != $2',
      [wallet_address, req.params.id]
    );
    if (walletExists.rows.length > 0) {
      return res.status(400).json({ error: 'Wallet address already registered to another account' });
    }

    await db.query('UPDATE spectators SET wallet_address = $1 WHERE id = $2', [wallet_address, req.params.id]);
    res.json({ success: true, wallet_address });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update wallet' });
  }
});

// ========== SPECTATOR PREDICTIONS ==========

// Submit a prediction for a game
router.post('/games/:gameId/predictions', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { spectatorId, spectatorAccountId, predictedTraitorIds, walletAddress } = req.body;

    if (!spectatorId || !predictedTraitorIds || !Array.isArray(predictedTraitorIds)) {
      return res.status(400).json({ error: 'spectatorId and predictedTraitorIds array required' });
    }

    // Validate wallet address if provided
    if (walletAddress && !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // If spectator account provided, verify it exists and get wallet from it
    let resolvedWallet = walletAddress;
    if (spectatorAccountId) {
      const spectator = await db.query('SELECT wallet_address FROM spectators WHERE id = $1', [spectatorAccountId]);
      if (spectator.rows.length > 0 && spectator.rows[0].wallet_address) {
        resolvedWallet = spectator.rows[0].wallet_address;
      }
    }

    if (predictedTraitorIds.length !== 2) {
      return res.status(400).json({ error: 'Must predict exactly 2 traitors' });
    }

    // Check game exists and is in progress
    const gameState = await redis.get(`game:${gameId}`);
    if (!gameState) {
      return res.status(404).json({ error: 'Game not found or already finished' });
    }

    const state = JSON.parse(gameState);
    if (state.status === 'finished') {
      return res.status(400).json({ error: 'Cannot predict on finished game' });
    }

    // Only allow predictions during the first 3 rounds
    if (state.currentRound > 3) {
      return res.status(400).json({ error: 'Predictions are only allowed during the first 3 rounds' });
    }

    // Verify predicted IDs are valid agents in this game
    const validIds = state.agents.map(a => a.agent_id);
    for (const id of predictedTraitorIds) {
      if (!validIds.includes(id)) {
        return res.status(400).json({ error: `Invalid agent ID: ${id}` });
      }
    }

    // Check if this wallet already predicted in this game
    if (resolvedWallet) {
      const existing = await db.query(
        `SELECT id FROM predictions WHERE game_id = $1 AND wallet_address = $2 AND spectator_id != $3`,
        [gameId, resolvedWallet, spectatorId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'This wallet has already submitted a prediction for this game' });
      }
    }

    // Check if this spectator account already predicted in this game
    if (spectatorAccountId) {
      const existing = await db.query(
        `SELECT id FROM predictions WHERE game_id = $1 AND spectator_account_id = $2 AND spectator_id != $3`,
        [gameId, spectatorAccountId, spectatorId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'You have already submitted a prediction for this game' });
      }
    }

    // Insert or update prediction
    await db.query(
      `INSERT INTO predictions (game_id, spectator_id, predicted_traitor_ids, wallet_address, spectator_account_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, spectator_id) 
       DO UPDATE SET predicted_traitor_ids = $3, wallet_address = $4, spectator_account_id = $5, created_at = NOW()`,
      [gameId, spectatorId, predictedTraitorIds, resolvedWallet || null, spectatorAccountId || null]
    );

    res.json({ success: true, message: 'Prediction submitted!' });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Failed to submit prediction' });
  }
});

// Get predictions for a game
router.get('/games/:gameId/predictions', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { spectatorId } = req.query;

    // If spectatorId provided, get their prediction
    if (spectatorId) {
      const result = await db.query(
        `SELECT predicted_traitor_ids, is_correct, points_earned, created_at
         FROM predictions WHERE game_id = $1 AND spectator_id = $2`,
        [gameId, spectatorId]
      );
      return res.json(result.rows[0] || null);
    }

    // Otherwise get stats
    const result = await db.query(
      `SELECT COUNT(*) as total_predictions,
              COUNT(CASE WHEN is_correct = true THEN 1 END) as correct_predictions
       FROM predictions WHERE game_id = $1`,
      [gameId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get predictions error:', error);
    res.status(500).json({ error: 'Failed to get predictions' });
  }
});

// Get prediction results after game ends (called by game engine)
router.get('/games/:gameId/predictions/results', async (req, res) => {
  try {
    const { gameId } = req.params;

    const result = await db.query(
      `SELECT spectator_id, predicted_traitor_ids, is_correct, points_earned
       FROM predictions 
       WHERE game_id = $1 AND is_correct IS NOT NULL
       ORDER BY points_earned DESC`,
      [gameId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get prediction results error:', error);
    res.status(500).json({ error: 'Failed to get prediction results' });
  }
});

// ========== ACHIEVEMENTS ==========

// Get all achievements
router.get('/achievements', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, icon, category, requirement_type, requirement_value, points, rarity
       FROM achievements
       ORDER BY category, requirement_value`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ error: 'Failed to get achievements' });
  }
});

// Get agent's achievements
router.get('/agents/:agentId/achievements', async (req, res) => {
  try {
    const { agentId } = req.params;

    // Get all achievements with unlock status for this agent
    const result = await db.query(
      `SELECT a.id, a.name, a.description, a.icon, a.category, a.points, a.rarity,
              aa.unlocked_at, aa.game_id,
              CASE WHEN aa.id IS NOT NULL THEN true ELSE false END as unlocked
       FROM achievements a
       LEFT JOIN agent_achievements aa ON a.id = aa.achievement_id AND aa.agent_id = $1
       ORDER BY a.category, a.requirement_value`,
      [agentId]
    );

    // Separate unlocked and locked
    const unlocked = result.rows.filter(r => r.unlocked);
    const locked = result.rows.filter(r => !r.unlocked);

    res.json({
      total: result.rows.length,
      unlocked: unlocked.length,
      achievements: { unlocked, locked }
    });
  } catch (error) {
    console.error('Get agent achievements error:', error);
    res.status(500).json({ error: 'Failed to get agent achievements' });
  }
});

// Get agent's achievements by name (for profile page)
router.get('/agents/name/:name/achievements', async (req, res) => {
  try {
    const { name } = req.params;

    // Get agent ID first
    const agentResult = await db.query(
      'SELECT id FROM agents WHERE agent_name = $1',
      [name]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agentId = agentResult.rows[0].id;

    // Get all achievements with unlock status
    const result = await db.query(
      `SELECT a.id, a.name, a.description, a.icon, a.category, a.points, a.rarity,
              aa.unlocked_at,
              CASE WHEN aa.id IS NOT NULL THEN true ELSE false END as unlocked
       FROM achievements a
       LEFT JOIN agent_achievements aa ON a.id = aa.achievement_id AND aa.agent_id = $1
       ORDER BY 
         CASE WHEN aa.id IS NOT NULL THEN 0 ELSE 1 END,
         a.category, a.requirement_value`,
      [agentId]
    );

    const unlocked = result.rows.filter(r => r.unlocked);
    const locked = result.rows.filter(r => !r.unlocked);

    res.json({
      total: result.rows.length,
      unlocked: unlocked.length,
      achievements: { unlocked, locked }
    });
  } catch (error) {
    console.error('Get agent achievements error:', error);
    res.status(500).json({ error: 'Failed to get agent achievements' });
  }
});

// ========== SPECTATOR CHAT ==========

// Get spectator chat for a game
router.get('/games/:gameId/spectator-chat', async (req, res) => {
  try {
    const { gameId } = req.params;
    const chatKey = `game:${gameId}:spectator-chat`;
    
    const messages = await redis.lRange(chatKey, 0, -1);
    const parsed = messages.map(m => JSON.parse(m));
    
    res.json({
      messages: parsed,
      total: parsed.length
    });
  } catch (error) {
    console.error('Get spectator chat error:', error);
    res.status(500).json({ error: 'Failed to get spectator chat' });
  }
});

// Send spectator chat message
router.post('/games/:gameId/spectator-chat', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { name, message } = req.body;
    
    if (!name || !message) {
      return res.status(400).json({ error: 'Name and message required' });
    }
    
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message too long (max 500 chars)' });
    }
    
    // Check if game exists
    const cached = await redis.get(`game:${gameId}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const chatMessage = {
      id: `spec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.slice(0, 30),
      message: message.trim(),
      timestamp: Date.now()
    };
    
    // Store in Redis (keep last 100 messages, 2 hour TTL)
    const chatKey = `game:${gameId}:spectator-chat`;
    await redis.rPush(chatKey, JSON.stringify(chatMessage));
    await redis.lTrim(chatKey, -100, -1);
    await redis.expire(chatKey, 7200);
    
    // Broadcast to all spectators
    const io = req.app.get('io');
    io.to(`game:${gameId}`).emit('spectator_chat', chatMessage);
    
    res.json({ success: true, message: chatMessage });
  } catch (error) {
    console.error('Send spectator chat error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
