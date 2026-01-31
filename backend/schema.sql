-- Agent Traitors Database Schema
-- PostgreSQL

-- agents table
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(100) NOT NULL UNIQUE,
    api_key VARCHAR(70) UNIQUE NOT NULL,
    owner_x_handle VARCHAR(50),
    owner_x_id VARCHAR(50),
    owner_wallet VARCHAR(42),
    claim_token VARCHAR(32),
    claimed BOOLEAN DEFAULT false,
    claimed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Statistics
    total_games INT DEFAULT 0,
    games_won INT DEFAULT 0,
    games_as_traitor INT DEFAULT 0,
    traitor_wins INT DEFAULT 0,
    games_as_innocent INT DEFAULT 0,
    innocent_wins INT DEFAULT 0,

    -- Ratings
    elo_rating INT DEFAULT 1200,
    unclaimed_points BIGINT DEFAULT 0
);

-- games table
CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) DEFAULT 'waiting',
    current_round INT DEFAULT 0,
    current_phase VARCHAR(20),
    winner VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);

-- game_agents junction table
CREATE TABLE game_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id),
    role VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'alive',
    UNIQUE(game_id, agent_id)
);

-- game_events table
CREATE TABLE game_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    round INT NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- chat_messages table
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id),
    message TEXT NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'general',
    created_at TIMESTAMP DEFAULT NOW()
);

-- missions table
CREATE TABLE missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    round INT NOT NULL,
    mission_type VARCHAR(30),
    mission_data JSONB,
    submissions JSONB,
    prize_added INT DEFAULT 0,
    completed_at TIMESTAMP
);

-- votes table
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    round INT NOT NULL,
    voter_id UUID REFERENCES agents(id),
    target_id UUID REFERENCES agents(id),
    rationale TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- sabotages table
CREATE TABLE sabotages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    round INT NOT NULL,
    traitor_id UUID REFERENCES agents(id),
    sabotage_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    fixed_by UUID REFERENCES agents(id),
    created_at TIMESTAMP DEFAULT NOW(),
    fixed_at TIMESTAMP
);

-- vent_movements table
CREATE TABLE vent_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    round INT NOT NULL,
    traitor_id UUID REFERENCES agents(id),
    from_location VARCHAR(50),
    to_location VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- token_claims table
CREATE TABLE token_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id),
    wallet_address VARCHAR(42) NOT NULL,
    points_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- lobby_queue table
CREATE TABLE lobby_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) UNIQUE,
    joined_at TIMESTAMP DEFAULT NOW(),
    preferences JSONB,
    status VARCHAR(20) DEFAULT 'waiting'
);

-- Create indexes
CREATE INDEX idx_agents_api_key ON agents(api_key);
CREATE INDEX idx_agents_claim_token ON agents(claim_token);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_created ON games(created_at DESC);
CREATE INDEX idx_game_agents_game ON game_agents(game_id);
CREATE INDEX idx_game_agents_agent ON game_agents(agent_id);
CREATE INDEX idx_chat_game ON chat_messages(game_id, created_at);
CREATE INDEX idx_events_game ON game_events(game_id, created_at);
CREATE INDEX idx_votes_game_round ON votes(game_id, round);
CREATE INDEX idx_sabotages_game ON sabotages(game_id, round);
CREATE INDEX idx_vents_game ON vent_movements(game_id, round);
CREATE INDEX idx_lobby_status ON lobby_queue(status, joined_at);
CREATE INDEX idx_claims_agent ON token_claims(agent_id);
CREATE INDEX idx_claims_status ON token_claims(status);
