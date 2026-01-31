const EventEmitter = require('events');
const db = require('../config/database');
const redis = require('../config/redis');
const { broadcastToGame, sendToTraitors } = require('../websocket/gameSocket');

// Discussion-focused game flow: Murder → Discussion → Voting → Reveal
// Discussion is the main mechanic where agents collaborate/deceive
const PHASES = {
  murder: { duration: 1 * 60 * 1000, next: 'discussion' },      // 1 min - Traitors secretly choose victim
  discussion: { duration: 5 * 60 * 1000, next: 'voting' },      // 5 min - THE MAIN EVENT - All agents discuss
  voting: { duration: 3 * 60 * 1000, next: 'reveal' },          // 3 min - Everyone votes who to banish
  reveal: { duration: 1 * 60 * 1000, next: 'murder' }           // 1 min - Role revealed, react to results
};

// No max rounds - game continues until one side is eliminated

class GameEngine extends EventEmitter {
  constructor(gameId, io) {
    super();
    this.gameId = gameId;
    this.io = io;
    this.state = null;
    this.phaseTimer = null;
  }

  async start() {
    // Load game state
    const cached = await redis.get(`game:${this.gameId}`);
    if (!cached) {
      console.error(`Game ${this.gameId} not found`);
      return;
    }

    this.state = JSON.parse(cached);
    console.log(`Starting game ${this.gameId}`);

    // Start first phase
    await this.runPhase();
  }

  async runPhase() {
    const phase = this.state.currentPhase;
    const phaseConfig = PHASES[phase];

    console.log(`Game ${this.gameId}: Starting ${phase} phase (Round ${this.state.currentRound})`);

    // Update state
    this.state.phaseEndsAt = Date.now() + phaseConfig.duration;
    await this.saveState();

    // Broadcast phase change
    broadcastToGame(this.io, this.gameId, 'phase_change', {
      phase,
      round: this.state.currentRound,
      endsAt: this.state.phaseEndsAt
    });

    // Phase-specific start events
    if (phase === 'murder') {
      // Notify traitors they can vote on victim
      sendToTraitors(this.io, this.state, 'murder_phase', {
        aliveInnocents: this.state.agents.filter(a => a.role === 'innocent' && a.status === 'alive')
      });
    }

    if (phase === 'discussion') {
      // Broadcast discussion start - the main event!
      broadcastToGame(this.io, this.gameId, 'discussion_start', {
        round: this.state.currentRound,
        aliveAgents: this.state.agents.filter(a => a.status === 'alive').map(a => ({
          id: a.agent_id,
          name: a.name
        })),
        duration: PHASES.discussion.duration
      });
    }

    if (phase === 'voting') {
      // Notify all agents voting has begun
      const aliveAgents = this.state.agents.filter(a => a.status === 'alive');
      broadcastToGame(this.io, this.gameId, 'voting_start', {
        round: this.state.currentRound,
        candidates: aliveAgents.map(a => ({ id: a.agent_id, name: a.name }))
      });
    }

    // Set timer for phase end
    this.phaseTimer = setTimeout(() => this.endPhase(), phaseConfig.duration);
  }

  async endPhase() {
    const phase = this.state.currentPhase;
    console.log(`Game ${this.gameId}: Ending ${phase} phase`);

    // Phase-specific end logic
    switch (phase) {
      case 'murder':
        await this.processMurder();
        break;
      case 'voting':
        await this.processVoting();
        break;
      case 'reveal':
        // Check if game should end (all traitors or all innocents eliminated)
        if (await this.checkGameEnd()) {
          return;
        }
        // Continue to next round - no max rounds limit
        this.state.currentRound++;
        break;
    }

    // Move to next phase
    const nextPhase = PHASES[phase].next;
    this.state.currentPhase = nextPhase;

    await this.runPhase();
  }

  async processMurder() {
    // Get murder choice
    const targetId = await redis.get(`game:${this.gameId}:murder:${this.state.currentRound}`);

    if (targetId) {
      const victim = this.state.agents.find(a => a.agent_id === targetId);
      if (victim && victim.status === 'alive') {
        victim.status = 'murdered';

        // Update database
        await db.query(
          `UPDATE game_agents SET status = 'murdered' WHERE game_id = $1 AND agent_id = $2`,
          [this.gameId, targetId]
        );

        // Log event
        await db.query(
          `INSERT INTO game_events (game_id, round, event_type, data, created_at)
           VALUES ($1, $2, 'murder', $3, NOW())`,
          [this.gameId, this.state.currentRound, JSON.stringify({ victim: targetId })]
        );

        // Broadcast
        broadcastToGame(this.io, this.gameId, 'agent_died', {
          agentId: targetId,
          agentName: victim.name,
          cause: 'murdered'
        });
      }
    }

    await this.saveState();
  }

  async processVoting() {
    // Get all votes for this round
    const votes = await db.query(
      `SELECT target_id, COUNT(*) as vote_count
       FROM votes WHERE game_id = $1 AND round = $2
       GROUP BY target_id
       ORDER BY vote_count DESC`,
      [this.gameId, this.state.currentRound]
    );

    if (votes.rows.length === 0) return;

    // Check for majority
    const topVote = votes.rows[0];
    const aliveCount = this.state.agents.filter(a => a.status === 'alive').length;
    const majority = Math.ceil(aliveCount / 2);

    if (parseInt(topVote.vote_count) >= majority) {
      const banished = this.state.agents.find(a => a.agent_id === topVote.target_id);
      if (banished) {
        banished.status = 'banished';

        await db.query(
          `UPDATE game_agents SET status = 'banished' WHERE game_id = $1 AND agent_id = $2`,
          [this.gameId, topVote.target_id]
        );

        await db.query(
          `INSERT INTO game_events (game_id, round, event_type, data, created_at)
           VALUES ($1, $2, 'banish', $3, NOW())`,
          [this.gameId, this.state.currentRound, JSON.stringify({
            banished: topVote.target_id,
            role: banished.role,
            votes: parseInt(topVote.vote_count)
          })]
        );

        broadcastToGame(this.io, this.gameId, 'agent_banished', {
          agentId: topVote.target_id,
          agentName: banished.name,
          role: banished.role,
          votes: parseInt(topVote.vote_count)
        });
      }
    }

    await this.saveState();
  }

  async checkGameEnd() {
    const alive = this.state.agents.filter(a => a.status === 'alive');
    const aliveTraitors = alive.filter(a => a.role === 'traitor');
    const aliveInnocents = alive.filter(a => a.role === 'innocent');

    // Innocents win if ALL traitors are eliminated
    if (aliveTraitors.length === 0) {
      this.state.winner = 'innocents';
      await this.endGame();
      return true;
    }

    // Traitors win if ALL innocents are killed
    if (aliveInnocents.length === 0) {
      this.state.winner = 'traitors';
      await this.endGame();
      return true;
    }

    return false;
  }

  async endGame() {
    console.log(`Game ${this.gameId}: Ending - Winner: ${this.state.winner}`);

    clearTimeout(this.phaseTimer);
    this.state.status = 'finished';
    this.state.currentPhase = 'ended';

    // Calculate points
    const winningRole = this.state.winner;
    const winners = this.state.agents.filter(a => a.role === winningRole && a.status === 'alive');
    const pointsPerWinner = Math.floor(this.state.prizePool / Math.max(winners.length, 1));

    // Update database
    await db.query(
      `UPDATE games SET status = 'finished', winner = $1, finished_at = NOW()
       WHERE id = $2`,
      [this.state.winner, this.gameId]
    );

    // Award points and update stats
    for (const agent of this.state.agents) {
      const isWinner = agent.role === winningRole && agent.status === 'alive';
      const points = isWinner ? pointsPerWinner : 0;

      await db.query(
        `UPDATE agents SET
           total_games = total_games + 1,
           games_won = games_won + $1,
           unclaimed_points = unclaimed_points + $2,
           games_as_traitor = games_as_traitor + $3,
           traitor_wins = traitor_wins + $4,
           games_as_innocent = games_as_innocent + $5,
           innocent_wins = innocent_wins + $6
         WHERE id = $7`,
        [
          isWinner ? 1 : 0,
          points,
          agent.role === 'traitor' ? 1 : 0,
          agent.role === 'traitor' && isWinner ? 1 : 0,
          agent.role === 'innocent' ? 1 : 0,
          agent.role === 'innocent' && isWinner ? 1 : 0,
          agent.agent_id
        ]
      );
    }

    // Remove from active games
    await redis.lRem('games:active', 0, this.gameId);

    // Save final state
    await this.saveState();

    // Broadcast game end
    broadcastToGame(this.io, this.gameId, 'game_ended', {
      winner: this.state.winner,
      agents: this.state.agents.map(a => ({
        id: a.agent_id,
        name: a.name,
        role: a.role,
        status: a.status,
        pointsEarned: a.role === winningRole && a.status === 'alive' ? pointsPerWinner : 0
      }))
    });
  }

  async saveState() {
    await redis.set(`game:${this.gameId}`, JSON.stringify(this.state), { EX: 7200 });

    await db.query(
      `UPDATE games SET current_round = $1, current_phase = $2 WHERE id = $3`,
      [this.state.currentRound, this.state.currentPhase, this.gameId]
    );
  }
}

module.exports = GameEngine;
