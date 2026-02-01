const redis = require('../config/redis');
const db = require('../config/database');
const { broadcastToGame } = require('../websocket/gameSocket');

// Maximum time a phase can be stuck before we force-end it (30 seconds past phaseEndsAt)
const STUCK_THRESHOLD_MS = 30 * 1000;

// Check interval
const CHECK_INTERVAL_MS = 15 * 1000; // Check every 15 seconds

class GameWatchdog {
  constructor(io) {
    this.io = io;
    this.interval = null;
  }

  start() {
    console.log('[Watchdog] Starting game watchdog...');
    this.interval = setInterval(() => this.checkStuckGames(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkStuckGames() {
    try {
      const gameIds = await redis.lRange('games:active', 0, -1);
      const now = Date.now();

      for (const gameId of gameIds) {
        const cached = await redis.get(`game:${gameId}`);
        if (!cached) {
          // Game state missing - remove from active list
          console.log(`[Watchdog] Game ${gameId} has no state, removing from active list`);
          await redis.lRem('games:active', 0, gameId);
          continue;
        }

        const state = JSON.parse(cached);

        // Skip finished games
        if (state.status === 'finished' || state.currentPhase === 'ended') {
          continue;
        }

        // Check if phase is stuck (past end time + threshold)
        const timeSincePhaseEnd = now - state.phaseEndsAt;
        if (timeSincePhaseEnd > STUCK_THRESHOLD_MS) {
          console.log(`[Watchdog] Game ${gameId} stuck in ${state.currentPhase} phase for ${Math.round(timeSincePhaseEnd / 1000)}s - forcing recovery`);
          await this.recoverStuckGame(gameId, state);
        }

        // Check for abandoned games (no alive players with active connections)
        const aliveAgents = state.agents.filter(a => a.status === 'alive');
        if (aliveAgents.length === 0) {
          console.log(`[Watchdog] Game ${gameId} has no alive players - ending game`);
          await this.endAbandonedGame(gameId, state);
        }
      }
    } catch (err) {
      console.error('[Watchdog] Error checking stuck games:', err);
    }
  }

  async recoverStuckGame(gameId, state) {
    try {
      const GameEngine = require('./GameEngine');
      
      // Determine next phase based on current phase
      const phaseOrder = ['starting', 'murder', 'discussion', 'voting', 'reveal'];
      const currentIdx = phaseOrder.indexOf(state.currentPhase);
      
      let nextPhase;
      let nextRound = state.currentRound;
      
      if (state.currentPhase === 'reveal' || state.currentPhase === 'voting') {
        // After voting/reveal, go to murder and increment round
        nextPhase = 'murder';
        nextRound = state.currentRound + 1;
      } else if (currentIdx >= 0 && currentIdx < phaseOrder.length - 1) {
        nextPhase = phaseOrder[currentIdx + 1];
      } else {
        nextPhase = 'murder';
        nextRound = state.currentRound + 1;
      }

      // Update state
      state.currentPhase = nextPhase;
      state.currentRound = nextRound;
      state.phaseEndsAt = Date.now() + 60000; // 1 minute for recovered phase

      // Save state
      await redis.set(`game:${gameId}`, JSON.stringify(state), { EX: 7200 });

      // Notify players
      broadcastToGame(this.io, gameId, 'phase_change', {
        phase: nextPhase,
        round: nextRound,
        endsAt: state.phaseEndsAt,
        recovered: true
      });

      broadcastToGame(this.io, gameId, 'game_notice', {
        message: 'Game recovered from stuck state',
        type: 'warning'
      });

      console.log(`[Watchdog] Game ${gameId} recovered - moved to ${nextPhase} phase, round ${nextRound}`);

      // Restart the game engine for this game
      const engine = GameEngine.getEngine(gameId);
      if (!engine) {
        console.log(`[Watchdog] No engine found for game ${gameId}, creating new one`);
        const newEngine = new GameEngine(gameId, this.io);
        await newEngine.start();
      }
    } catch (err) {
      console.error(`[Watchdog] Failed to recover game ${gameId}:`, err);
    }
  }

  async endAbandonedGame(gameId, state) {
    try {
      state.status = 'finished';
      state.currentPhase = 'ended';
      state.winner = 'abandoned';
      state.winReason = 'All players eliminated or disconnected';

      await redis.set(`game:${gameId}`, JSON.stringify(state), { EX: 600 }); // 10 min TTL
      await redis.lRem('games:active', 0, gameId);

      await db.query(
        `UPDATE games SET status = 'finished', winner = 'abandoned', finished_at = NOW() WHERE id = $1`,
        [gameId]
      );

      broadcastToGame(this.io, gameId, 'game_ended', {
        winner: 'abandoned',
        winReason: 'Game ended - no active players',
        agents: state.agents
      });

      console.log(`[Watchdog] Game ${gameId} ended as abandoned`);
    } catch (err) {
      console.error(`[Watchdog] Failed to end abandoned game ${gameId}:`, err);
    }
  }
}

module.exports = GameWatchdog;
