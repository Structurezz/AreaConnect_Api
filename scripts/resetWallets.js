require('dotenv').config();
const mongoose = require('mongoose');
const User       = require('../models/User');
const Payment    = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Zero out walletBalance on every user
  const users = await User.updateMany({}, { $set: { walletBalance: 0 } });
  console.log(`✓ Reset walletBalance to 0 on ${users.modifiedCount} user(s)`);

  // 2. Delete all withdrawal records
  const withdrawals = await Withdrawal.deleteMany({});
  console.log(`✓ Deleted ${withdrawals.deletedCount} withdrawal record(s)`);

  // 3. Reset all paid payments back to pending
  const payments = await Payment.updateMany(
    { status: 'paid' },
    { $set: { status: 'pending', paidAt: null, method: null, recordedBy: null, notes: null } }
  );
  console.log(`✓ Reset ${payments.modifiedCount} paid payment(s) back to pending`);

  console.log('\nAll wallet balances cleared. Ready for Paystack live keys.');
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
