const EventEmitter = require('events');
const db = require('../config/database');
const redis = require('../config/redis');
const { broadcastToGame, sendToTraitors, sendToAgent, getDisconnectedAgents, cleanupGameConnections } = require('../websocket/gameSocket');

// Discussion-focused game flow: Murder → Discussion → Voting → Reveal
// Discussion is the main mechanic where agents collaborate/deceive

// TEST MODE - Short timers for testing (uncomment to use)
// const PHASES = {
//   murder: { duration: 10 * 1000, next: 'discussion' },      // 10s - TEST
//   discussion: { duration: 30 * 1000, next: 'voting' },      // 30s - TEST
//   voting: { duration: 15 * 1000, next: 'reveal' },          // 15s - TEST
//   reveal: { duration: 5 * 1000, next: 'murder' }            // 5s - TEST
// };

// PRODUCTION - Real game timings (phases end early when all actions complete)
const PHASES = {
  starting: { duration: 8 * 1000, next: 'murder' },         // 8s for agents to join
  murder: { duration: 15 * 1000, next: 'discussion' },      // 15s max (ends when target picked)
  discussion: { duration: 2 * 60 * 1000, next: 'voting' },  // 2 min
  voting: { duration: 60 * 1000, next: 'reveal' },          // 1 min (ends when all vote)
  reveal: { duration: 3 * 1000, next: 'murder' }            // 3s (instant reveal)
};

// Store active game engines for vote checking
const activeEngines = new Map();

// No max rounds - game continues until one side is eliminated

class GameEngine extends EventEmitter {
  constructor(gameId, io) {
    super();
    this.gameId = gameId;
    this.io = io;
    this.state = null;
    this.phaseTimer = null;
    this.pendingBanishment = null; // Store banishment for reveal phase
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

    // Register this engine for vote checking
    activeEngines.set(this.gameId, this);

    // Start first phase
    await this.runPhase();
  }

  // Check if all alive agents have voted - called from vote API
  async checkAllVoted() {
    if (this.state.currentPhase !== 'voting') return false;
    if (this.votingEndScheduled) return false; // Already scheduled to end

    const aliveAgents = this.state.agents.filter(a => a.status === 'alive');
    const voteCount = await db.query(
      `SELECT COUNT(DISTINCT voter_id) as count FROM votes WHERE game_id = $1 AND round = $2`,
      [this.gameId, this.state.currentRound]
    );

    const votedCount = parseInt(voteCount.rows[0].count);
    console.log(`Game ${this.gameId}: ${votedCount}/${aliveAgents.length} votes in`);

    if (votedCount >= aliveAgents.length) {
      console.log(`Game ${this.gameId}: All votes in! Waiting 5s before ending voting.`);
      this.votingEndScheduled = true;
      
      // Notify spectators that all votes are in
      broadcastToGame(this.io, this.gameId, 'all_votes_in', {
        message: 'All agents have voted! Results in 5 seconds...',
        countdown: 5
      });
      
      // Wait 5 seconds so spectators can see final vote tallies
      clearTimeout(this.phaseTimer);
      this.phaseTimer = setTimeout(async () => {
        this.votingEndScheduled = false;
        await this.endPhase();
      }, 5000);
      return true;
    }
    return false;
  }

  // Check if murder target has been selected - end phase early
  async checkMurderComplete() {
    if (this.state.currentPhase !== 'murder') return false;

    const targetId = await redis.get(`game:${this.gameId}:murder:${this.state.currentRound}`);
    if (targetId) {
      console.log(`Game ${this.gameId}: Murder target selected! Ending murder phase early.`);
      clearTimeout(this.phaseTimer);
      await this.endPhase();
      return true;
    }
    return false;
  }

  // Static method to get engine instance for a game
  static getEngine(gameId) {
    return activeEngines.get(gameId);
  }

  // Eliminate any agents that have disconnected
  async eliminateDisconnectedAgents() {
    const aliveAgents = this.state.agents.filter(a => a.status === 'alive');
    const aliveIds = aliveAgents.map(a => a.agent_id);
    const disconnected = getDisconnectedAgents(this.gameId, aliveIds);

    if (disconnected.length === 0) return false;

    console.log(`Game ${this.gameId}: Found ${disconnected.length} disconnected agents to eliminate`);

    for (const agentId of disconnected) {
      const agent = this.state.agents.find(a => a.agent_id === agentId);
      if (!agent || agent.status !== 'alive') continue;

      console.log(`Game ${this.gameId}: Eliminating disconnected agent ${agent.name}`);
      agent.status = 'disconnected';

      // Update database
      await db.query(
        `UPDATE game_agents SET status = 'disconnected' WHERE game_id = $1 AND agent_id = $2`,
        [this.gameId, agentId]
      );

      // Log event
      await db.query(
        `INSERT INTO game_events (game_id, round, event_type, data, created_at)
         VALUES ($1, $2, 'disconnect', $3, NOW())`,
        [this.gameId, this.state.currentRound, JSON.stringify({ eliminated: agentId, name: agent.name })]
      );

      // Broadcast to everyone
      broadcastToGame(this.io, this.gameId, 'agent_died', {
        agentId,
        agentName: agent.name,
        cause: 'disconnected',
        role: agent.role  // Reveal role on disconnect
      });
    }

    await this.saveState();
    return true;
  }

  async runPhase() {
    const phase = this.state.currentPhase;
    const phaseConfig = PHASES[phase];

    console.log(`Game ${this.gameId}: Starting ${phase} phase (Round ${this.state.currentRound})`);

    // Check for disconnected agents at phase start (except starting phase)
    if (phase !== 'starting') {
      await this.eliminateDisconnectedAgents();
      // Check if game should end after eliminations
      if (await this.checkGameEnd()) {
        return;
      }
    }

    // Update state
    this.state.phaseEndsAt = Date.now() + phaseConfig.duration;
    await this.saveState();

    // Broadcast phase change
    console.log(`Game ${this.gameId}: [BROADCAST] phase_change: ${phase} (round ${this.state.currentRound})`);
    broadcastToGame(this.io, this.gameId, 'phase_change', {
      phase,
      round: this.state.currentRound,
      endsAt: this.state.phaseEndsAt
    });

    // Phase-specific start events
    if (phase === 'starting') {
      // Notify all players game is starting soon
      broadcastToGame(this.io, this.gameId, 'game_starting', {
        gameId: this.gameId,
        startsIn: PHASES.starting.duration,
        agents: this.state.agents.map(a => ({
          id: a.agent_id,
          name: a.name,
          model: a.model
        }))
      });
    }

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

    if (phase === 'reveal') {
      console.log(`Game ${this.gameId}: [REVEAL] phase_change already sent, now calling processReveal`);
      // Process reveal IMMEDIATELY - no waiting
      await this.processReveal();
      console.log(`Game ${this.gameId}: [REVEAL] processReveal complete`);
      
      // Check if game should end
      if (await this.checkGameEnd()) {
        return;
      }
      
      // Short pause then move to next round
      this.state.currentRound++;
      console.log(`Game ${this.gameId}: [REVEAL] Starting 3s timer before murder phase`);
      this.phaseTimer = setTimeout(() => {
        console.log(`Game ${this.gameId}: [REVEAL] 3s timer complete, moving to murder`);
        this.state.currentPhase = PHASES[phase].next;
        this.runPhase();
      }, 3000); // Just 3 second pause after reveal
      return;
    }

    // Set timer for phase end
    this.phaseTimer = setTimeout(() => this.endPhase(), phaseConfig.duration);
  }

  async endPhase() {
    const phase = this.state.currentPhase;
    
    // Guard: if game already ended or phase is invalid, do nothing
    if (!phase || !PHASES[phase] || phase === 'ended') {
      console.log(`Game ${this.gameId}: Ignoring endPhase for invalid/ended phase: ${phase}`);
      return;
    }
    
    console.log(`Game ${this.gameId}: Ending ${phase} phase`);

    // Phase-specific end logic
    switch (phase) {
      case 'murder':
        await this.processMurder();
        // Check if game ends after murder (all innocents eliminated)
        if (await this.checkGameEnd()) {
          return;
        }
        break;
      case 'voting':
        await this.processVoting();
        break;
      case 'reveal':
        // Reveal is now processed in runPhase immediately
        // This shouldn't be called, but handle gracefully
        return;
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

        // Broadcast to everyone
        broadcastToGame(this.io, this.gameId, 'agent_died', {
          agentId: targetId,
          agentName: victim.name,
          cause: 'murdered'
        });

        // Notify the murdered agent directly - they are out!
        sendToAgent(this.io, targetId, 'you_eliminated', {
          reason: 'murdered',
          message: 'You were murdered by the traitors! You can no longer participate but can watch.',
          round: this.state.currentRound
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

    this.pendingBanishment = null;

    if (votes.rows.length === 0) {
      broadcastToGame(this.io, this.gameId, 'no_banishment', {
        message: 'No votes cast. No one was banished.'
      });
      return;
    }

    // Use PLURALITY voting - whoever has the most votes gets banished (no tie allowed)
    const topVote = votes.rows[0];
    const topVoteCount = parseInt(topVote.vote_count);

    // Check if there's a tie (second place has same votes as first)
    const isTie = votes.rows.length > 1 && parseInt(votes.rows[1].vote_count) === topVoteCount;

    if (isTie) {
      // Tie vote - no one banished
      broadcastToGame(this.io, this.gameId, 'no_banishment', {
        message: 'Vote tied! No one was banished.',
        topVotes: votes.rows.filter(v => parseInt(v.vote_count) === topVoteCount).map(v => {
          const agent = this.state.agents.find(a => a.agent_id === v.target_id);
          return { agentId: v.target_id, agentName: agent?.name, votes: parseInt(v.vote_count) };
        })
      });
    } else {
      // Plurality wins - whoever has most votes gets banished
      const banished = this.state.agents.find(a => a.agent_id === topVote.target_id);
      if (banished) {
        // Store pending banishment - will be revealed after countdown
        this.pendingBanishment = {
          agentId: topVote.target_id,
          agentName: banished.name,
          role: banished.role,
          votes: topVoteCount
        };

        // Broadcast that someone will be banished (but NOT their role yet)
        broadcastToGame(this.io, this.gameId, 'banishment_pending', {
          agentId: topVote.target_id,
          agentName: banished.name,
          votes: topVoteCount
        });
      }
    }

    await this.saveState();
  }

  async processReveal() {
    console.log(`Game ${this.gameId}: processReveal called, pendingBanishment:`, this.pendingBanishment);
    if (!this.pendingBanishment) {
      // No one to reveal
      console.log(`Game ${this.gameId}: No pending banishment to reveal`);
      return;
    }

    const { agentId, agentName, role, votes } = this.pendingBanishment;
    
    // Update agent status
    const banished = this.state.agents.find(a => a.agent_id === agentId);
    if (banished) {
      banished.status = 'banished';
    }

    // Update database
    await db.query(
      `UPDATE game_agents SET status = 'banished' WHERE game_id = $1 AND agent_id = $2`,
      [this.gameId, agentId]
    );

    // Log event
    await db.query(
      `INSERT INTO game_events (game_id, round, event_type, data, created_at)
       VALUES ($1, $2, 'banish', $3, NOW())`,
      [this.gameId, this.state.currentRound, JSON.stringify({
        banished: agentId,
        role: role,
        votes: votes
      })]
    );

    // NOW reveal the role!
    console.log(`Game ${this.gameId}: Broadcasting agent_banished for ${agentName} (${role})`);
    broadcastToGame(this.io, this.gameId, 'agent_banished', {
      agentId,
      agentName,
      role,  // Role revealed here!
      votes,
      wasTraitor: role === 'traitor'
    });

    // Notify the banished agent directly - they are out!
    sendToAgent(this.io, agentId, 'you_eliminated', {
      reason: 'banished',
      message: 'You were voted out! You can no longer participate but can watch.',
      round: this.state.currentRound,
      yourRole: role
    });

    this.pendingBanishment = null;
    await this.saveState();
  }

  async checkGameEnd() {
    const alive = this.state.agents.filter(a => a.status === 'alive');
    const aliveTraitors = alive.filter(a => a.role === 'traitor');
    const aliveInnocents = alive.filter(a => a.role === 'innocent');
    
    // Count disconnected agents
    const disconnected = this.state.agents.filter(a => a.status === 'disconnected');
    const totalPlayers = this.state.agents.length;

    console.log(`Game ${this.gameId}: Checking end - ${aliveTraitors.length} traitors, ${aliveInnocents.length} innocents alive, ${disconnected.length} disconnected`);

    // If too many disconnected (>50%), abandon the game - no winner
    if (disconnected.length > totalPlayers / 2) {
      this.state.winner = 'abandoned';
      this.state.winReason = 'Too many agents disconnected. Game abandoned.';
      await this.endGame();
      return true;
    }

    // Innocents win if ALL traitors are eliminated (not just disconnected)
    // Only count if traitors were actually eliminated via gameplay
    const eliminatedTraitors = this.state.agents.filter(a => a.role === 'traitor' && a.status === 'banished');
    const disconnectedTraitors = this.state.agents.filter(a => a.role === 'traitor' && a.status === 'disconnected');
    
    if (aliveTraitors.length === 0 && eliminatedTraitors.length > 0) {
      // At least one traitor was legitimately banished
      this.state.winner = 'innocents';
      this.state.winReason = 'All traitors have been found and eliminated!';
      await this.endGame();
      return true;
    } else if (aliveTraitors.length === 0 && disconnectedTraitors.length > 0 && eliminatedTraitors.length === 0) {
      // All traitors just disconnected - abandon instead
      this.state.winner = 'abandoned';
      this.state.winReason = 'All traitors disconnected. Game abandoned.';
      await this.endGame();
      return true;
    }

    // Traitors win if ALL innocents are eliminated
    if (aliveInnocents.length === 0) {
      this.state.winner = 'traitors';
      this.state.winReason = 'All innocents have been eliminated!';
      await this.endGame();
      return true;
    }

    // Game continues - both sides still have members
    return false;
  }

  async endGame() {
    console.log(`Game ${this.gameId}: Ending - Winner: ${this.state.winner}`);

    clearTimeout(this.phaseTimer);
    this.state.status = 'finished';
    this.state.currentPhase = 'ended';

    // Update database
    await db.query(
      `UPDATE games SET status = 'finished', winner = $1, finished_at = NOW()
       WHERE id = $2`,
      [this.state.winner, this.gameId]
    );

    // If game was abandoned, don't update stats or distribute points
    if (this.state.winner === 'abandoned') {
      console.log(`Game ${this.gameId}: Abandoned - no points distributed`);
    } else {
      // Calculate points - convert plural winner to singular role
      const winningRole = this.state.winner === 'innocents' ? 'innocent' : 'traitor';
      const winners = this.state.agents.filter(a => a.role === winningRole && a.status === 'alive');
      const pointsPerWinner = Math.floor(this.state.prizePool / Math.max(winners.length, 1));

      // Fetch current ELO ratings for all agents
      const agentIds = this.state.agents.map(a => a.agent_id);
      const eloResult = await db.query(
        `SELECT id, elo_rating FROM agents WHERE id = ANY($1)`,
        [agentIds]
      );
      const eloMap = new Map(eloResult.rows.map(r => [r.id, r.elo_rating || 1200]));
      const avgElo = eloResult.rows.reduce((sum, r) => sum + (r.elo_rating || 1200), 0) / Math.max(eloResult.rows.length, 1);

      // Award points and update stats including ELO
      const K = 32; // ELO K-factor
      for (const agent of this.state.agents) {
        const isWinner = agent.role === winningRole && agent.status === 'alive';
        const points = isWinner ? pointsPerWinner : 0;

        // Calculate ELO change
        const currentElo = eloMap.get(agent.agent_id) || 1200;
        const expectedScore = 1 / (1 + Math.pow(10, (avgElo - currentElo) / 400));
        const actualScore = isWinner ? 1 : 0;
        const eloChange = Math.round(K * (actualScore - expectedScore));

        await db.query(
          `UPDATE agents SET
             total_games = total_games + 1,
             games_won = games_won + $1,
             unclaimed_points = unclaimed_points + $2,
             games_as_traitor = games_as_traitor + $3,
             traitor_wins = traitor_wins + $4,
             games_as_innocent = games_as_innocent + $5,
             innocent_wins = innocent_wins + $6,
             current_streak = CASE WHEN $1 = 1 THEN current_streak + 1 ELSE 0 END,
             best_streak = CASE WHEN $1 = 1 AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END,
             elo_rating = GREATEST(100, elo_rating + $8)
           WHERE id = $7`,
          [
            isWinner ? 1 : 0,
            points,
            agent.role === 'traitor' ? 1 : 0,
            agent.role === 'traitor' && isWinner ? 1 : 0,
            agent.role === 'innocent' ? 1 : 0,
            agent.role === 'innocent' && isWinner ? 1 : 0,
            agent.agent_id,
            eloChange
          ]
        );
      }
    }

    // Score spectator predictions
    if (this.state.winner !== 'abandoned') {
      await this.scorePredictions();
    }

    // Check and unlock achievements for all agents
    await this.checkAchievements();

    // Remove from active games
    await redis.lRem('games:active', 0, this.gameId);
    
    // Remove engine from active engines
    activeEngines.delete(this.gameId);

    // Cleanup connection tracking
    cleanupGameConnections(this.gameId);

    // Save final state
    await this.saveState();

    // Broadcast game end
    const isAbandoned = this.state.winner === 'abandoned';
    const winningRole = this.state.winner === 'innocents' ? 'innocent' : 'traitor';
    const winners = isAbandoned ? [] : this.state.agents.filter(a => a.role === winningRole && a.status === 'alive');
    const pointsPerWinner = isAbandoned ? 0 : Math.floor(this.state.prizePool / Math.max(winners.length, 1));

    broadcastToGame(this.io, this.gameId, 'game_ended', {
      winner: this.state.winner,
      winReason: this.state.winReason || (isAbandoned ? 'Game abandoned' : `${this.state.winner} win!`),
      abandoned: isAbandoned,
      agents: this.state.agents.map(a => ({
        id: a.agent_id,
        name: a.name,
        role: a.role,
        status: a.status,
        model: a.model,
        pointsEarned: isAbandoned ? 0 : (a.role === winningRole && a.status === 'alive' ? pointsPerWinner : 0)
      }))
    });
  }

  async saveState() {
    // 10 minutes TTL for finished games, 2 hours for active games
    const ttl = this.state.status === 'finished' ? 600 : 7200;
    await redis.set(`game:${this.gameId}`, JSON.stringify(this.state), { EX: ttl });

    await db.query(
      `UPDATE games SET current_round = $1, current_phase = $2 WHERE id = $3`,
      [this.state.currentRound, this.state.currentPhase, this.gameId]
    );
  }

  // Score spectator predictions after game ends
  async scorePredictions() {
    try {
      // Get actual traitor IDs
      const traitorIds = this.state.agents
        .filter(a => a.role === 'traitor')
        .map(a => a.agent_id);

      // Get all predictions for this game
      const predictions = await db.query(
        `SELECT id, spectator_id, spectator_account_id, predicted_traitor_ids FROM predictions WHERE game_id = $1`,
        [this.gameId]
      );

      for (const pred of predictions.rows) {
        const predictedIds = pred.predicted_traitor_ids || [];
        
        // Count correct predictions (how many of the predicted IDs are actual traitors)
        const correctCount = predictedIds.filter(id => traitorIds.includes(id)).length;
        
        // Calculate points: 50 per correct traitor, bonus 100 for getting both
        let pointsEarned = correctCount * 50;
        const isFullyCorrect = correctCount === 2;
        if (isFullyCorrect) {
          pointsEarned += 100; // Bonus for getting both
        }

        await db.query(
          `UPDATE predictions 
           SET is_correct = $1, points_earned = $2 
           WHERE id = $3`,
          [isFullyCorrect, pointsEarned, pred.id]
        );

        // Update spectator account stats
        if (pred.spectator_account_id) {
          await db.query(
            `UPDATE spectators 
             SET total_predictions = total_predictions + 1,
                 correct_predictions = correct_predictions + CASE WHEN $1 THEN 1 ELSE 0 END,
                 total_points = total_points + $2
             WHERE id = $3`,
            [isFullyCorrect, pointsEarned, pred.spectator_account_id]
          );
        }
      }

      console.log(`Game ${this.gameId}: Scored ${predictions.rows.length} predictions`);
    } catch (error) {
      console.error('Error scoring predictions:', error);
    }
  }

  // Check and unlock achievements for all agents after game
  async checkAchievements() {
    try {
      // Get all achievement definitions
      const achievementsResult = await db.query('SELECT * FROM achievements');
      const achievements = achievementsResult.rows;

      for (const agent of this.state.agents) {
        // Get agent's current stats
        const statsResult = await db.query(
          `SELECT total_games, games_won, best_streak, traitor_wins, innocent_wins, elo_rating
           FROM agents WHERE id = $1`,
          [agent.agent_id]
        );

        if (statsResult.rows.length === 0) continue;
        const stats = statsResult.rows[0];

        // Get agent's already unlocked achievements
        const unlockedResult = await db.query(
          'SELECT achievement_id FROM agent_achievements WHERE agent_id = $1',
          [agent.agent_id]
        );
        const unlockedIds = new Set(unlockedResult.rows.map(r => r.achievement_id));

        // Check each achievement
        const newUnlocks = [];
        for (const ach of achievements) {
          if (unlockedIds.has(ach.id)) continue; // Already unlocked

          let value = 0;
          switch (ach.requirement_type) {
            case 'games_played':
              value = stats.total_games;
              break;
            case 'games_won':
              value = stats.games_won;
              break;
            case 'best_streak':
              value = stats.best_streak;
              break;
            case 'traitor_wins':
              value = stats.traitor_wins;
              break;
            case 'innocent_wins':
              value = stats.innocent_wins;
              break;
            case 'elo_rating':
              value = stats.elo_rating;
              break;
          }

          if (value >= ach.requirement_value) {
            newUnlocks.push(ach);
          }
        }

        // Insert new unlocks
        for (const ach of newUnlocks) {
          await db.query(
            `INSERT INTO agent_achievements (agent_id, achievement_id, game_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, achievement_id) DO NOTHING`,
            [agent.agent_id, ach.id, this.gameId]
          );
          console.log(`🏆 ${agent.name} unlocked: ${ach.icon} ${ach.name}`);
        }

        // Broadcast achievement unlocks to the game
        if (newUnlocks.length > 0) {
          broadcastToGame(this.io, this.gameId, 'achievements_unlocked', {
            agentId: agent.agent_id,
            agentName: agent.name,
            achievements: newUnlocks.map(a => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              description: a.description,
              rarity: a.rarity
            }))
          });
        }
      }
    } catch (error) {
      console.error('Error checking achievements:', error);
    }
  }
}

module.exports = GameEngine;
