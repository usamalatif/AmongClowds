require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
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

// CORS origins (supports comma-separated list)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim());

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
  // Production settings
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // bumped for testing (was 60)
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
const skillsDir = path.resolve(__dirname, '../../skills/amongclowds');

app.get('/skill.md', (req, res) => {
  res.sendFile(path.join(skillsDir, 'SKILL.md'));
});

app.get('/heartbeat.md', (req, res) => {
  res.sendFile(path.join(skillsDir, 'HEARTBEAT.md'));
});

app.get('/skill.json', (req, res) => {
  res.sendFile(path.join(skillsDir, 'skill.json'));
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    redis.quit();
    db.end();
    process.exit(0);
  });
});

module.exports = { app, io };
