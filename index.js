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
require('./services/callService').startSweeper(); // tidies calls left hanging by a restart

// Railway sits in front of us — trust its proxy so req.ip is the client's
// (rate limits would otherwise lump everyone together)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// gzip JSON responses (lists shrink 5–10×)
app.use(require('compression')());
app.use(mongoSanitize());

// CORS
const allowedOrigins = [
  'https://area-mates.areaconnect.pro',
  'https://area-connector.areaconnect.pro',
  'https://area-connect-admin.areaconnect.pro',
  'https://area-connect-security.areaconnect.pro',
  'https://areaconnector-guards-production.up.railway.app',
  'https://area-guards.areaconnect.pro',
  'https://admin.areaconnect.pro',
  'https://areaconnect.pro',
  'https://www.areaconnect.pro',
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
  // Lets apps read the filename of downloaded files (e.g. credit receipts).
  exposedHeaders: ['Content-Disposition'],
}));

// Body parsing
// `verify` keeps the exact raw bytes for the Paystack webhook: its HMAC must
// be computed over the body as sent. (Previously this global parser consumed
// the body first, the webhook route then tried to JSON.parse "[object Object]"
// and answered 400 to every Paystack webhook.)
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl.startsWith('/api/plans/webhook')) req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'test') {
  // Short production logs; skip health checks
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev', { skip: (req) => req.path === '/health' }));
}

// Static files
// Legacy disk-based uploads (pre-GridFS). Kept so any old URL still floating
// around keeps working on dev; Railway wipes this on redeploy so most will
// 404 in prod — new uploads go through /files which hits GridFS.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// GridFS-backed uploads (persistent, survives redeploys)
app.use('/files', require('./routes/files'));

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
app.use('/api/dj', require('./routes/dj'));
app.use('/api/podcast', require('./routes/podcast'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/guards', require('./routes/guards'));
app.use('/api/team',   require('./routes/team'));
app.use('/api/household', require('./routes/household'));
app.use('/api/site', require('./routes/site'));
app.use('/api/gatelog', require('./routes/gatelog'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/pitch',  require('./routes/pitch'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/blog', require('./routes/blog'));
app.use('/api/court', require('./routes/court'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/admin/withdrawals', require('./routes/adminWithdrawals'));
app.use('/api/admin/marketplace', require('./routes/adminMarketplace'));
app.use('/api/push', require('./routes/push'));
app.use('/api/admin/payments',    require('./routes/adminPayments'));
app.use('/api/admin/credits',     require('./routes/adminCredits'));
app.use('/api/admin/onboarding',  require('./routes/adminOnboarding'));
app.use('/api/admin/security',    require('./routes/adminSecurity'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/safety', require('./routes/safety'));
app.use('/api/public/avatar', require('./routes/publicAvatar'));

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Estate Management API running', timestamp: new Date() });
});

// One-time demo seed endpoint
// Never available in production, and only with an explicit SEED_SECRET.
app.post('/api/seed-demo', async (req, res) => {
  const seedSecret = process.env.SEED_SECRET;
  if (process.env.NODE_ENV === 'production' || !seedSecret || req.headers['x-seed-secret'] !== seedSecret) {
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

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/estate_management', {
  // Keep warm connections (no cold TLS handshakes to Atlas after idle)
  maxPoolSize: 50, minPoolSize: 5, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.io ready`);
    });

    // Subscription auditor — sweeps once a day (and on boot) to renew or
    // expire stale subscriptions. Opt-out with SUBSCRIPTION_AUDITOR=off.
    if (process.env.SUBSCRIPTION_AUDITOR !== 'off') {
      const { startSubscriptionAuditor } = require('./services/subscriptionAuditor');
      startSubscriptionAuditor();
    }
    // Trial check-in: emails each trial estate's manager once, ≤3 days before
    // the trial ends. Opt-out with TRIAL_CHECKIN=off.
    if (process.env.NODE_ENV !== 'test' && process.env.TRIAL_CHECKIN !== 'off') require('./services/trialCheckin').startTrialCheckin();
    // Marketplace escrow: auto-release delivered orders, expire unpaid checkouts.
    if (process.env.NODE_ENV !== 'test') require('./services/marketplaceEscrow').startEscrowSweeper();
    // Visitor passes: expire unused passes once their time window closes.
    if (process.env.NODE_ENV !== 'test') require('./utils/passExpiry').startPassExpirySweeper();
    if (process.env.NODE_ENV !== 'test') require('./utils/stays').startStaySweeper();
    if (process.env.NODE_ENV !== 'test') require('./services/alertRouting').startEscalationSweeper();
    // Landing-site blog: Gemini writes and publishes one article a day.
    // Opt-out with BLOG_AUTOPUBLISH=off.
    if (process.env.NODE_ENV !== 'test') require('./services/blogWriter').startBlogWriter();
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = { app, server };
