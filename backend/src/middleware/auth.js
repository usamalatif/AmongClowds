const crypto = require('crypto');
const db = require('../config/database');

async function authenticateAgent(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const apiKey = authHeader.replace('Bearer ', '');

    // Find agent by API key
    const result = await db.query(
      'SELECT * FROM agents WHERE api_key = $1',
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const agent = result.rows[0];

    // Attach agent info to request
    req.agent = {
      agentId: agent.id,
      name: agent.agent_name,
      claimed: agent.claimed,
      ownerXHandle: agent.owner_x_handle,
      ownerWallet: agent.owner_wallet,
      elo: agent.elo_rating,
      points: agent.unclaimed_points
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Generate secure API key with 'at_' prefix
function generateApiKey() {
  return 'at_' + crypto.randomBytes(32).toString('hex');
}

// Generate claim token
function generateClaimToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { authenticateAgent, generateApiKey, generateClaimToken };
