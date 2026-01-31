const db = require('../config/database');

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

      // Increment spectator count
      const count = await redis.incr(`spectators:${gameId}`);

      // Broadcast updated spectator count to all in game
      io.to(`game:${gameId}`).emit('spectator_count', count);

      // Get current game state
      const cached = await redis.get(`game:${gameId}`);
      if (cached) {
        const gameState = JSON.parse(cached);
        // Send sanitized state (hide roles unless game is finished)
        const sanitizedState = {
          ...gameState,
          agents: gameState.agents.map(a => ({
            id: a.agent_id,
            name: a.name,
            status: a.status,
            // Only reveal role if agent is banished or game is finished
            role: (a.status === 'banished' || gameState.status === 'finished') ? a.role : undefined
          })),
          traitors: undefined // Never expose traitor list to spectators
        };
        socket.emit('game_state', sanitizedState);
      }

      const viewerType = socket.agentId ? `Agent ${socket.agentName}` : 'Spectator';
      console.log(`${viewerType} joined game ${gameId}`);
    });

    // Leave game room
    socket.on('leave_game', async (gameId) => {
      socket.leave(`game:${gameId}`);

      // Decrement spectator count and broadcast
      const count = await redis.decr(`spectators:${gameId}`);
      io.to(`game:${gameId}`).emit('spectator_count', Math.max(0, count));

      socket.currentGame = null;
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log('Client disconnected:', socket.id);

      if (socket.currentGame) {
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

module.exports = { setupWebSocket, broadcastToGame, sendToAgent, sendToTraitors };
