/**
 * clearVisitors.js
 * 1. Checks out all visitors that are not already checked-out/expired/blacklisted
 * 2. Deletes every document in the Visitor collection
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Visitor  = require('../models/Visitor');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to:', process.env.MONGODB_URI);

  // Step 1 — check out anyone still active / pending / checked-in
  const checkoutResult = await Visitor.updateMany(
    { status: { $in: ['active', 'pending', 'checked-in'] } },
    { status: 'checked-out', exitTime: new Date() }
  );
  console.log(`Checked out ${checkoutResult.modifiedCount} visitor(s).`);

  // Step 2 — delete all
  const countBefore = await Visitor.countDocuments();
  const deleteResult = await Visitor.deleteMany({});
  console.log(`Deleted ${deleteResult.deletedCount} of ${countBefore} visitor record(s).`);

  await mongoose.disconnect();
  console.log('Done.');
}




run().catch(err => { console.error(err); process.exit(1); });



