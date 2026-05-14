require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Estate = require('../models/Estate');
const User = require('../models/User');
const Unit = require('../models/Unit');
const Visitor = require('../models/Visitor');
const Announcement = require('../models/Announcement');
const MarketplaceListing = require('../models/MarketplaceListing');
const Alert = require('../models/Alert');
const { generateVisitorCode } = require('../services/qrService');

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/estate_management');
  console.log('Connected to MongoDB...');

  // Clear existing demo data
  await Promise.all([
    Estate.deleteMany({ name: /Greenfield/i }),
    User.deleteMany({ email: /@estate-demo\.com/ }),
  ]);

  const hash = (pw) => bcrypt.hash(pw, 12);

  // 1. Super Admin
  const superAdmin = await User.create({
    name: 'Super Admin',
    email: 'admin@estate-demo.com',
    phone: '+2348000000000',
    passwordHash: await hash('Admin@123'),
    role: 'super_admin',
    isActive: true,
  });

  // 2. Estate
  const estate = await Estate.create({
    name: 'Greenfield Estate',
    address: '12 Victoria Island, Lagos, Nigeria',
    estateCode: 'GREEN1',
    managerId: superAdmin._id,
  });

  // 3. Estate Manager
  const manager = await User.create({
    name: 'Emeka Johnson',
    email: 'manager@estate-demo.com',
    phone: '+2348011111111',
    passwordHash: await hash('Manager@123'),
    role: 'estate_manager',
    estateId: estate._id,
    isActive: true,
  });

  // Update estate manager
  estate.managerId = manager._id;
  await estate.save();

  // 4. Security Guard
  const security = await User.create({
    name: 'Chidi Okafor',
    email: 'security@estate-demo.com',
    phone: '+2348022222222',
    passwordHash: await hash('Security@123'),
    role: 'security',
    estateId: estate._id,
    isActive: true,
  });

  // 5. Units
  const [unit1, unit2, unit3] = await Unit.create([
    { estateId: estate._id, unitNumber: 'A101', block: 'A', type: 'apartment', status: 'occupied' },
    { estateId: estate._id, unitNumber: 'A102', block: 'A', type: 'apartment', status: 'occupied' },
    { estateId: estate._id, unitNumber: 'B201', block: 'B', type: 'house', status: 'occupied' },
    { estateId: estate._id, unitNumber: 'B202', block: 'B', type: 'house', status: 'vacant' },
    { estateId: estate._id, unitNumber: 'C301', block: 'C', type: 'apartment', status: 'vacant' },
  ]);

  // 6. Residents
  const [resident1, resident2, resident3] = await User.create([
    {
      name: 'Adaeze Obi',
      email: 'resident1@estate-demo.com',
      phone: '+2348033333333',
      passwordHash: await hash('Resident@123'),
      role: 'resident',
      estateId: estate._id,
      unitId: unit1._id,
      isActive: true,
    },
    {
      name: 'Tunde Bakare',
      email: 'resident2@estate-demo.com',
      phone: '+2348044444444',
      passwordHash: await hash('Resident@123'),
      role: 'resident',
      estateId: estate._id,
      unitId: unit2._id,
      isActive: true,
    },
    {
      name: 'Ngozi Eze',
      email: 'resident3@estate-demo.com',
      phone: '+2348055555555',
      passwordHash: await hash('Resident@123'),
      role: 'resident',
      estateId: estate._id,
      unitId: unit3._id,
      isActive: true,
    },
  ]);

  // Update units with resident references
  await Unit.findByIdAndUpdate(unit1._id, { residentId: resident1._id });
  await Unit.findByIdAndUpdate(unit2._id, { residentId: resident2._id });
  await Unit.findByIdAndUpdate(unit3._id, { residentId: resident3._id });

  // 7. Sample Visitors
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await Visitor.create([
    {
      estateId: estate._id,
      hostResidentId: resident1._id,
      hostUnitId: unit1._id,
      visitorName: 'Michael Adekunle',
      visitorPhone: '+2348066666666',
      purpose: 'Family visit',
      expectedDate: tomorrow,
      visitorCode: 'ABC123',
      qrCodeUrl: '',
      status: 'active',
    },
    {
      estateId: estate._id,
      hostResidentId: resident2._id,
      hostUnitId: unit2._id,
      visitorName: 'Grace Oluwole',
      visitorPhone: '+2348077777777',
      purpose: 'Delivery',
      expectedDate: new Date(),
      visitorCode: 'DEF456',
      qrCodeUrl: '',
      status: 'checked-in',
      entryTime: new Date(),
      verifiedBySecurityId: security._id,
    },
    {
      estateId: estate._id,
      hostResidentId: resident3._id,
      hostUnitId: unit3._id,
      visitorName: 'David Musa',
      visitorPhone: '+2348088888888',
      purpose: 'Business meeting',
      expectedDate: new Date(Date.now() - 86400000),
      visitorCode: 'GHI789',
      qrCodeUrl: '',
      status: 'checked-out',
      entryTime: new Date(Date.now() - 7200000),
      exitTime: new Date(Date.now() - 3600000),
    },
  ]);

  // 8. Announcements
  await Announcement.create([
    {
      estateId: estate._id,
      authorId: manager._id,
      title: 'Welcome to Greenfield Estate Portal',
      body: 'We are pleased to announce the launch of our new estate management system. You can now pre-register visitors, access community marketplace, and chat with neighbours directly from this platform.',
      category: 'general',
      isPinned: true,
    },
    {
      estateId: estate._id,
      authorId: manager._id,
      title: 'Water Supply Maintenance — Saturday 8AM-2PM',
      body: 'Please be informed that there will be a scheduled maintenance of the water supply system this Saturday between 8AM and 2PM. Residents are advised to store enough water beforehand.',
      category: 'maintenance',
    },
    {
      estateId: estate._id,
      authorId: manager._id,
      title: 'Estate Community Day — June 15th',
      body: 'Join us for our annual community day at the estate park. There will be games, food, and entertainment for residents and their families. All are welcome!',
      category: 'event',
    },
  ]);

  // 9. Marketplace Listings
  await MarketplaceListing.create([
    {
      estateId: estate._id,
      sellerId: resident1._id,
      title: 'Fresh Homemade Jollof Rice — Daily',
      description: 'Delicious homemade jollof rice available every day. Can deliver within the estate. Minimum order 2 plates.',
      price: 1500,
      category: 'food',
      contactPhone: resident1.phone,
      status: 'active',
    },
    {
      estateId: estate._id,
      sellerId: resident2._id,
      title: 'Professional Plumbing Services',
      description: 'Licensed plumber available for all estate repairs. Water leaks, pipe fitting, toilet repairs and more. Quick response guaranteed.',
      price: 5000,
      category: 'services',
      contactPhone: resident2.phone,
      status: 'active',
    },
    {
      estateId: estate._id,
      sellerId: resident3._id,
      title: 'Samsung 55" Smart TV — Slightly Used',
      description: '2022 model Samsung QLED TV. Works perfectly. Selling due to upgrade. Includes remote and wall bracket.',
      price: 180000,
      category: 'items_for_sale',
      contactPhone: resident3.phone,
      status: 'active',
    },
  ]);

  // 10. Sample Alert
  await Alert.create({
    estateId: estate._id,
    residentId: resident1._id,
    unitId: unit1._id,
    type: 'noise',
    note: 'Loud music from neighbouring unit since midnight',
    status: 'resolved',
    resolvedBy: manager._id,
    resolvedAt: new Date(Date.now() - 3600000),
  });

  console.log('\n✅ Seed complete! Demo credentials:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Super Admin  → admin@estate-demo.com    / Admin@123');
  console.log('Manager      → manager@estate-demo.com  / Manager@123');
  console.log('Security     → security@estate-demo.com / Security@123');
  console.log('Resident 1   → resident1@estate-demo.com / Resident@123');
  console.log('Resident 2   → resident2@estate-demo.com / Resident@123');
  console.log('Resident 3   → resident3@estate-demo.com / Resident@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Estate Code: GREEN1');
  console.log('Visitor Codes: ABC123, DEF456, GHI789\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
