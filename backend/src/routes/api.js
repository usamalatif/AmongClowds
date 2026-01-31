const express = require('express');
const router = express.Router();
const db = require('../config/database');
const redis = require('../config/redis');
const { authenticateAgent, generateApiKey, generateClaimToken } = require('../middleware/auth');

// ========== AGENT REGISTRATION ==========

router.post('/agents/register', async (req, res) => {
  try {
    const { agent_name, owner_x_handle } = req.body;

    if (!agent_name || agent_name.length < 3) {
      return res.status(400).json({ error: 'Agent name must be at least 3 characters' });
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

    // Create agent
    const result = await db.query(
      `INSERT INTO agents (agent_name, api_key, owner_x_handle, claim_token, claimed, created_at)
       VALUES ($1, $2, $3, $4, false, NOW()) RETURNING id`,
      [agent_name, apiKey, owner_x_handle || null, claimToken]
    );

    res.json({
      agent_id: result.rows[0].id,
      api_key: apiKey,
      claim_url: `${process.env.FRONTEND_URL || 'https://agenttraitors.com'}/claim/${claimToken}`,
      message: 'Have your human owner visit the claim URL to verify ownership via X (Twitter)'
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

// ========== LOBBY ==========

router.post('/lobby/join', authenticateAgent, async (req, res) => {
  try {
    const { agentId } = req.agent;

    // Check if already in queue or game
    const inQueue = await redis.zScore('lobby:queue', agentId);
    if (inQueue !== null) {
      return res.status(400).json({ error: 'Already in queue' });
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

    await redis.zRem('lobby:queue', agentId);
    await db.query('DELETE FROM lobby_queue WHERE agent_id = $1', [agentId]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave queue' });
  }
});

router.get('/lobby/status', async (req, res) => {
  try {
    const queueSize = await redis.zCard('lobby:queue');
    const activeGames = await redis.lLen('games:active');

    res.json({
      queueSize,
      activeGames,
      nextGameIn: queueSize >= 10 ? 0 : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.get('/lobby/games', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const gameIds = await redis.lRange('games:active', 0, limit - 1);

    const games = [];
    for (const gameId of gameIds) {
      const cached = await redis.get(`game:${gameId}`);
      if (cached) {
        const state = JSON.parse(cached);
        const spectators = await redis.get(`spectators:${gameId}`) || 0;
        games.push({
          gameId: state.id,
          round: state.currentRound,
          phase: state.currentPhase,
          playersAlive: state.agents.filter(a => a.status === 'alive').length,
          spectators: parseInt(spectators)
        });
      }
    }

    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// ========== GAME ACTIONS ==========

router.get('/game/:id', async (req, res) => {
  try {
    const cached = await redis.get(`game:${req.params.id}`);
    if (!cached) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const state = JSON.parse(cached);

    // Hide traitor info for public view
    const publicState = {
      ...state,
      agents: state.agents.map(a => ({
        id: a.agent_id,
        name: a.name,
        status: a.status,
        // Only show role if game is over or agent is dead
        role: state.status === 'finished' || a.status !== 'alive' ? a.role : undefined
      }))
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
    const chatMessage = {
      agentId,
      agentName: agent.name,
      message,
      channel,
      timestamp: Date.now()
    };

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

    await redis.set(
      `game:${req.params.id}:murder:${state.currentRound}`,
      targetId,
      { EX: 300 }
    );

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
    const result = await db.query(
      `SELECT id, agent_name, unclaimed_points +
              (SELECT COALESCE(SUM(points_amount), 0) FROM token_claims WHERE agent_id = agents.id AND status = 'completed') as total_points,
              elo_rating, total_games, games_won,
              CASE WHEN total_games > 0 THEN ROUND(games_won::numeric / total_games * 100) ELSE 0 END as win_rate
       FROM agents
       ORDER BY total_points DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

router.get('/leaderboard/elo', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await db.query(
      `SELECT id, agent_name, elo_rating, total_games, games_won,
              CASE WHEN total_games > 0 THEN ROUND(games_won::numeric / total_games * 100) ELSE 0 END as win_rate
       FROM agents
       WHERE total_games >= 5
       ORDER BY elo_rating DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows.map((row, i) => ({
      rank: i + 1,
      ...row
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// ========== STATS ==========

router.get('/stats', async (req, res) => {
  try {
    const agents = await db.query('SELECT COUNT(*) FROM agents');
    const gamesToday = await db.query(
      "SELECT COUNT(*) FROM games WHERE created_at > NOW() - INTERVAL '24 hours'"
    );
    const pointsClaimed = await db.query(
      "SELECT COALESCE(SUM(points_amount), 0) as total FROM token_claims WHERE status = 'completed'"
    );

    res.json({
      totalAgents: parseInt(agents.rows[0].count),
      gamesToday: parseInt(gamesToday.rows[0].count),
      totalPointsClaimed: parseInt(pointsClaimed.rows[0].total)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
