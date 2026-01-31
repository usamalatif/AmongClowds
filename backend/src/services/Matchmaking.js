const db = require('../config/database');
const redis = require('../config/redis');
const { broadcastToGame, sendToAgent } = require('../websocket/gameSocket');

const GAME_SIZE = 10;
const TRAITOR_COUNT = 2;

class Matchmaking {
  static async tryCreateGame(io) {
    const queueSize = await redis.zCard('lobby:queue');

    if (queueSize < GAME_SIZE) return null;

    // Get oldest agents from queue
    const agentIds = await redis.zRange('lobby:queue', 0, GAME_SIZE - 1);

    if (agentIds.length < GAME_SIZE) return null;

    // Create game in database
    const gameResult = await db.query(
      `INSERT INTO games (status, current_round, current_phase, created_at)
       VALUES ('setup', 0, 'setup', NOW()) RETURNING id`
    );

    const gameId = gameResult.rows[0].id;

    // Randomly assign traitors
    const shuffled = [...agentIds].sort(() => Math.random() - 0.5);
    const traitorIds = shuffled.slice(0, TRAITOR_COUNT);

    // Get agent names
    const agentData = await db.query(
      'SELECT id, agent_name FROM agents WHERE id = ANY($1)',
      [agentIds]
    );

    const agentMap = {};
    agentData.rows.forEach(a => {
      agentMap[a.id] = a.agent_name;
    });

    // Add agents to game
    const agents = [];
    for (const agentId of agentIds) {
      const role = traitorIds.includes(agentId) ? 'traitor' : 'innocent';

      await db.query(
        `INSERT INTO game_agents (game_id, agent_id, role, status)
         VALUES ($1, $2, $3, 'alive')`,
        [gameId, agentId, role]
      );

      agents.push({
        agent_id: agentId,
        name: agentMap[agentId],
        role,
        status: 'alive'
      });
    }

    // Remove from queue
    await redis.zRem('lobby:queue', agentIds);
    for (const agentId of agentIds) {
      await db.query('DELETE FROM lobby_queue WHERE agent_id = $1', [agentId]);
    }

    // Create initial game state - starts with murder phase
    const gameState = {
      id: gameId,
      status: 'active',
      currentRound: 1,
      currentPhase: 'murder',
      phaseEndsAt: Date.now() + 2 * 60 * 1000, // 2 minutes for murder phase
      agents,
      traitors: traitorIds,
      prizePool: 10000
    };

    // Save to Redis
    await redis.set(`game:${gameId}`, JSON.stringify(gameState), { EX: 7200 }); // 2 hour TTL
    await redis.lPush('games:active', gameId);

    // Update game status in database
    await db.query(
      `UPDATE games SET status = 'active', current_round = 1, current_phase = 'murder'
       WHERE id = $1`,
      [gameId]
    );

    // Notify all agents
    for (const agent of agents) {
      sendToAgent(io, agent.agent_id, 'game_matched', {
        gameId,
        role: agent.role,
        agents: agents.map(a => ({
          id: a.agent_id,
          name: a.name,
          status: a.status
        }))
      });
    }

    console.log(`Game ${gameId} created with ${GAME_SIZE} agents (${TRAITOR_COUNT} traitors)`);

    // Start game loop
    this.startGameLoop(io, gameId);

    return { id: gameId };
  }

  static async startGameLoop(io, gameId) {
    const GameEngine = require('./GameEngine');
    const engine = new GameEngine(gameId, io);
    await engine.start();
  }
}

module.exports = Matchmaking;
