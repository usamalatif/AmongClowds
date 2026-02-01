const db = require('../config/database');
const redis = require('../config/redis');
const { broadcastToGame, sendToAgent } = require('../websocket/gameSocket');

const GAME_SIZE = 10;      // 10 players per game
const TRAITOR_COUNT = 2;   // 2 traitors
const LOCK_KEY = 'matchmaking:lock';
const LOCK_TTL = 10;       // 10 second lock timeout

class Matchmaking {
  // Acquire distributed lock to prevent race conditions
  static async acquireLock() {
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const acquired = await redis.set(LOCK_KEY, lockId, { NX: true, EX: LOCK_TTL });
    return acquired ? lockId : null;
  }

  // Release lock only if we own it
  static async releaseLock(lockId) {
    const currentLock = await redis.get(LOCK_KEY);
    if (currentLock === lockId) {
      await redis.del(LOCK_KEY);
    }
  }

  static async tryCreateGame(io) {
    // Acquire lock to prevent race conditions
    const lockId = await this.acquireLock();
    if (!lockId) {
      // Another matchmaking in progress, skip
      return null;
    }

    try {
      const queueSize = await redis.zCard('lobby:queue');
      if (queueSize < GAME_SIZE) return null;

      // Get oldest agents from queue
      const agentIds = await redis.zRange('lobby:queue', 0, GAME_SIZE - 1);
      if (agentIds.length < GAME_SIZE) return null;

      // IMMEDIATELY remove from queue to prevent double-matching
      const removed = await redis.zRem('lobby:queue', agentIds);
      if (removed < GAME_SIZE) {
        // Some agents were already removed by another process, abort
        console.log(`Matchmaking conflict: only removed ${removed}/${GAME_SIZE} agents, aborting`);
        return null;
      }

      // Also remove from DB queue
      for (const agentId of agentIds) {
        await db.query('DELETE FROM lobby_queue WHERE agent_id = $1', [agentId]);
      }

      // Create game in database
      const gameResult = await db.query(
        `INSERT INTO games (status, current_round, current_phase, created_at)
         VALUES ('setup', 0, 'setup', NOW()) RETURNING id`
      );
      const gameId = gameResult.rows[0].id;

      // Randomly assign traitors
      const shuffled = [...agentIds].sort(() => Math.random() - 0.5);
      const traitorIds = shuffled.slice(0, TRAITOR_COUNT);

      // Get agent names and AI models
      const agentData = await db.query(
        'SELECT id, agent_name, ai_model FROM agents WHERE id = ANY($1)',
        [agentIds]
      );

      const agentMap = {};
      agentData.rows.forEach(a => {
        agentMap[a.id] = { name: a.agent_name, model: a.ai_model };
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
          name: agentMap[agentId].name,
          model: agentMap[agentId].model,
          role,
          status: 'alive'
        });
      }

      // Create initial game state - starts with starting phase for agents to join
      const gameState = {
        id: gameId,
        status: 'active',
        currentRound: 1,
        currentPhase: 'starting',
        phaseEndsAt: Date.now() + 8 * 1000, // 8s for agents to connect and join
        agents,
        traitors: traitorIds,
        prizePool: 1000
      };

      // Save to Redis
      await redis.set(`game:${gameId}`, JSON.stringify(gameState), { EX: 7200 }); // 2 hour TTL
      await redis.lPush('games:active', gameId);

      // Update game status in database
      await db.query(
        `UPDATE games SET status = 'active', current_round = 1, current_phase = 'starting'
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
    } finally {
      // Always release lock
      await this.releaseLock(lockId);
    }
  }

  static async startGameLoop(io, gameId) {
    const GameEngine = require('./GameEngine');
    const engine = new GameEngine(gameId, io);
    await engine.start();
  }
}

module.exports = Matchmaking;
