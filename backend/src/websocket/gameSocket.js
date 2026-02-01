const db = require('../config/database');

const REACTION_EMOJIS = ['👍', '😂', '🤔', '😱', '🔥', '🔴'];

// Track connected agents per game: { gameId: Set<agentId> }
const connectedAgents = new Map();

function setupWebSocket(io, redis) {
  io.on('connection', async (socket) => {
    console.log('Client connected:', socket.id);

    // Authenticate via API key
    socket.on('authenticate', async (data) => {
      try {
        const { apiKey } = data;

        const result = await db.query(
          'SELECT id, agent_name FROM agents WHERE api_key = $1',
          [apiKey]
        );

        if (result.rows.length === 0) {
          socket.emit('auth_error', { error: 'Invalid API key' });
          return;
        }

        const agent = result.rows[0];
        socket.agentId = agent.id;
        socket.agentName = agent.agent_name;

        // Join agent-specific room for private messages
        socket.join(`agent:${agent.id}`);

        socket.emit('authenticated', { agentId: agent.id, name: agent.agent_name });
        console.log(`Agent authenticated: ${agent.agent_name}`);
      } catch (error) {
        console.error('WebSocket auth error:', error);
        socket.emit('auth_error', { error: 'Authentication failed' });
      }
    });

    // Join game room (works for both agents and spectators)
    socket.on('join_game', async (gameId) => {
      socket.join(`game:${gameId}`);
      socket.currentGame = gameId;
      socket.isSpectator = !socket.agentId;

      // Track agent connection for auto-elimination
      if (socket.agentId) {
        if (!connectedAgents.has(gameId)) {
          connectedAgents.set(gameId, new Set());
        }
        connectedAgents.get(gameId).add(socket.agentId);
        console.log(`Agent ${socket.agentName} (${socket.agentId}) connected to game ${gameId}`);
      }

      // Increment spectator count
      const count = await redis.incr(`spectators:${gameId}`);

      // Broadcast updated spectator count to all in game
      io.to(`game:${gameId}`).emit('spectator_count', count);

      // Get current game state
      const cached = await redis.get(`game:${gameId}`);
      if (cached) {
        const gameState = JSON.parse(cached);
        
        // Find requesting agent's info if authenticated
        const myAgent = socket.agentId 
          ? gameState.agents.find(a => a.agent_id === socket.agentId)
          : null;
        const myRole = myAgent?.role;
        const isTraitor = myRole === 'traitor';
        
        // Get traitor teammates if agent is a traitor
        let traitorTeammates = null;
        if (isTraitor) {
          traitorTeammates = gameState.agents
            .filter(a => a.role === 'traitor' && a.agent_id !== socket.agentId)
            .map(a => ({ id: a.agent_id, name: a.name }));
        }
        
        // Calculate points for finished games
        let pointsPerWinner = 0;
        if (gameState.status === 'finished' && gameState.winner) {
          const winningRole = gameState.winner === 'innocents' ? 'innocent' : 'traitor';
          const winners = gameState.agents.filter(a => a.role === winningRole && a.status === 'alive');
          pointsPerWinner = Math.floor((gameState.prizePool || 10000) / Math.max(winners.length, 1));
        }

        // Send sanitized state (hide roles unless game is finished)
        const sanitizedState = {
          ...gameState,
          agents: gameState.agents.map(a => {
            const winningRole = gameState.winner === 'innocents' ? 'innocent' : 'traitor';
            const isWinner = gameState.status === 'finished' && a.role === winningRole && a.status === 'alive';
            return {
              id: a.agent_id,
              name: a.name,
              model: a.model,
              status: a.status,
              isAlive: a.status === 'alive',
              role: (a.status === 'banished' || gameState.status === 'finished') ? a.role : undefined,
              pointsEarned: gameState.status === 'finished' ? (a.pointsEarned || (isWinner ? pointsPerWinner : 0)) : undefined
            };
          }),
          traitors: undefined,
          yourRole: myRole,
          traitorTeammates: traitorTeammates
        };
        socket.emit('game_state', sanitizedState);

        // Send current sus poll results
        const susPoll = await redis.hGetAll(`sus:${gameId}`);
        if (Object.keys(susPoll).length > 0) {
          socket.emit('sus_poll_update', susPoll);
        }
      }

      const viewerType = socket.agentId ? `Agent ${socket.agentName}` : 'Spectator';
      console.log(`${viewerType} joined game ${gameId}`);
    });

    // Spectator reacts to a chat message
    socket.on('react_to_message', async (data) => {
      const { gameId, messageId, emoji } = data;
      
      if (!gameId || !messageId || !REACTION_EMOJIS.includes(emoji)) {
        return;
      }

      // Store reaction in Redis (key: reactions:{gameId}:{messageId})
      const reactionKey = `reactions:${gameId}:${messageId}`;
      await redis.hIncrBy(reactionKey, emoji, 1);
      await redis.expire(reactionKey, 7200); // 2 hour TTL

      // Get updated counts
      const reactions = await redis.hGetAll(reactionKey);

      // Broadcast to all in game
      io.to(`game:${gameId}`).emit('message_reactions', {
        messageId,
        reactions
      });
    });

    // Spectator votes who they think is a traitor
    socket.on('vote_suspect', async (data) => {
      const { gameId, agentId } = data;
      
      if (!gameId || !agentId) return;

      // Rate limit: one vote per spectator per 30 seconds
      const voteKey = `susvote:${gameId}:${socket.id}`;
      const lastVote = await redis.get(voteKey);
      if (lastVote) {
        socket.emit('vote_error', { error: 'Wait before voting again' });
        return;
      }

      // Get agent name
      const cached = await redis.get(`game:${gameId}`);
      if (!cached) return;
      
      const gameState = JSON.parse(cached);
      const agent = gameState.agents.find(a => a.agent_id === agentId);
      if (!agent || agent.status !== 'alive') return;

      // Record vote with 30s cooldown
      await redis.set(voteKey, '1', { EX: 30 });

      // Increment sus count for agent
      const susKey = `sus:${gameId}`;
      await redis.hIncrBy(susKey, agent.name, 1);
      await redis.expire(susKey, 7200);

      // Get updated poll
      const susPoll = await redis.hGetAll(susKey);

      // Broadcast to all
      io.to(`game:${gameId}`).emit('sus_poll_update', susPoll);
    });

    // Leave game room
    socket.on('leave_game', async (gameId) => {
      socket.leave(`game:${gameId}`);

      // Untrack agent connection
      if (socket.agentId && connectedAgents.has(gameId)) {
        connectedAgents.get(gameId).delete(socket.agentId);
        console.log(`Agent ${socket.agentName} left game ${gameId}`);
      }

      const count = await redis.decr(`spectators:${gameId}`);
      io.to(`game:${gameId}`).emit('spectator_count', Math.max(0, count));

      socket.currentGame = null;
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log('Client disconnected:', socket.id);

      if (socket.currentGame) {
        // Untrack agent connection
        if (socket.agentId && connectedAgents.has(socket.currentGame)) {
          connectedAgents.get(socket.currentGame).delete(socket.agentId);
          console.log(`Agent ${socket.agentName} (${socket.agentId}) disconnected from game ${socket.currentGame}`);
        }

        const count = await redis.decr(`spectators:${socket.currentGame}`);
        io.to(`game:${socket.currentGame}`).emit('spectator_count', Math.max(0, count));
      }
    });
  });

  return io;
}

// Broadcast to all players in a game
function broadcastToGame(io, gameId, event, data) {
  io.to(`game:${gameId}`).emit(event, data);
}

// Send to specific agent
function sendToAgent(io, agentId, event, data) {
  io.to(`agent:${agentId}`).emit(event, data);
}

// Send to traitors only
function sendToTraitors(io, gameState, event, data) {
  const traitors = gameState.agents.filter(a => a.role === 'traitor');
  traitors.forEach(traitor => {
    io.to(`agent:${traitor.agent_id}`).emit(event, data);
  });
}

// Check if an agent is connected to a game
function isAgentConnected(gameId, agentId) {
  if (!connectedAgents.has(gameId)) return false;
  return connectedAgents.get(gameId).has(agentId);
}

// Get all disconnected agents in a game
function getDisconnectedAgents(gameId, agentIds) {
  const connected = connectedAgents.get(gameId) || new Set();
  return agentIds.filter(id => !connected.has(id));
}

// Cleanup game connection tracking (call when game ends)
function cleanupGameConnections(gameId) {
  connectedAgents.delete(gameId);
  console.log(`Cleaned up connection tracking for game ${gameId}`);
}

module.exports = { 
  setupWebSocket, 
  broadcastToGame, 
  sendToAgent, 
  sendToTraitors,
  isAgentConnected,
  getDisconnectedAgents,
  cleanupGameConnections
};
