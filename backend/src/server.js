require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const db = require('./config/database');
const redis = require('./config/redis');
const routes = require('./routes/api');
const { setupWebSocket } = require('./websocket/gameSocket');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1', routes);

// Serve skill files
app.get('/skill.md', (req, res) => {
  res.sendFile(__dirname + '/../../skills/agent-traitors/SKILL.md');
});

app.get('/heartbeat.md', (req, res) => {
  res.sendFile(__dirname + '/../../skills/agent-traitors/HEARTBEAT.md');
});

app.get('/skill.json', (req, res) => {
  res.sendFile(__dirname + '/../../skills/agent-traitors/skill.json');
});

// WebSocket setup
setupWebSocket(io, redis);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    // Connect to Redis
    await redis.connect();
    console.log('Redis connected');

    // Test database connection
    await db.query('SELECT NOW()');
    console.log('Database connected');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = { app, io };
