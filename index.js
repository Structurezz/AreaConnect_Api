require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');

const { initSocket } = require('./services/socketService');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(mongoSanitize());

// CORS
const allowedOrigins = [
  'https://area-mates.areaconnect.pro',
  'https://area-connector.areaconnect.pro',
  'https://area-connect-admin.areaconnect.pro',
  'https://area-connect-security.areaconnect.pro',
  'https://areaconnector-guards-production.up.railway.app',
  'https://area-guards.areaconnect.pro',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',').map(o => o.trim()) : []),
  ...[5173, 5174, 5175, 5176, 5177, 5178, 5180, 5181].map(p => `http://localhost:${p}`),
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || /\.up\.railway\.app$/.test(origin) || /\.areaconnect\.pro$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/estates', require('./routes/estates'));
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/residents', require('./routes/residents'));
app.use('/api/units', require('./routes/units'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/events', require('./routes/events'));
app.use('/api/polls', require('./routes/polls'));
app.use('/api/lounge', require('./routes/lounge'));

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Estate Management API running', timestamp: new Date() });
});

// Temp: delete user by email
app.delete('/api/dev/user', async (req, res) => {
  const seedSecret = process.env.SEED_SECRET || 'area_connect_seed_2024';
  if (req.headers['x-seed-secret'] !== seedSecret) return res.status(403).json({ success: false });
  const User = require('./models/User');
  const { email } = req.query;
  const user = await User.findOneAndDelete({ email });
  if (!user) return res.json({ success: false, message: 'User not found' });
  res.json({ success: true, message: `Deleted user: ${user.email}` });
});

// One-time demo seed endpoint
app.post('/api/seed-demo', async (req, res) => {
  const seedSecret = process.env.SEED_SECRET || 'area_connect_seed_2024';
  if (req.headers['x-seed-secret'] !== seedSecret) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  try {
    const seed = require('./utils/seed');
    await seed();
    res.json({ success: true, message: 'Demo data seeded' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// Database connection and server start
const PORT = process.env.PORT || 6000;

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/estate_management')
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.io ready`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = { app, server };
