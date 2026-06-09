require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const COLLECTIONS = [
  'users', 'estates', 'units', 'visitors', 'announcements',
  'marketplacelistings', 'alerts', 'paymentschedules', 'paymentrecords',
  'wallets', 'withdrawals', 'subscriptions', 'plans', 'chatmessages',
  'polls', 'polloptions', 'pollvotes', 'loungesessions', 'events',
];

async function resetAndSeed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected. Dropping all collections...');

  const db = mongoose.connection.db;
  for (const col of COLLECTIONS) {
    try {
      await db.collection(col).drop();
      console.log(`  dropped: ${col}`);
    } catch {
      // collection didn't exist — fine
    }
  }

  console.log('\nAll collections cleared. Running seed...\n');
  await require('../utils/seed')();
}

resetAndSeed().catch(err => { console.error(err); process.exit(1); });
