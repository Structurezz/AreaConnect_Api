const Estate = require('../models/Estate');
const User = require('../models/User');
const Unit = require('../models/Unit');
const Visitor = require('../models/Visitor');
const Alert = require('../models/Alert');

exports.createEstate = async (req, res) => {
  try {
    const { name, address, managerId } = req.body;

    const estate = await Estate.create({ name, address, managerId });

    if (managerId) {
      await User.findByIdAndUpdate(managerId, {
        role: 'estate_manager',
        estateId: estate._id,
      });
    }

    return res.status(201).json({ success: true, message: 'Estate created', data: estate });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getAllEstates = async (req, res) => {
  try {
    const estates = await Estate.find()
      .populate('managerId', 'name email')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: estates });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEstate = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.estateId)
      .populate('managerId', 'name email phone');
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    return res.json({ success: true, data: estate });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEstateDetail = async (req, res) => {
  try {
    const { estateId } = req.params;

    const [estate, residents, securityStaff, units] = await Promise.all([
      Estate.findById(estateId).populate('managerId', 'name email phone'),
      User.find({ estateId, role: 'resident' })
        .populate('unitId', 'unitNumber block type')
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 }),
      User.find({ estateId, role: 'security' })
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 }),
      Unit.find({ estateId }).sort({ unitNumber: 1 }),
    ]);

    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });

    return res.json({
      success: true,
      data: { estate, residents, securityStaff, units },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateEstate = async (req, res) => {
  try {
    const { name, address, settings } = req.body;
    const estate = await Estate.findByIdAndUpdate(
      req.params.estateId,
      { name, address, settings },
      { new: true, runValidators: true }
    );
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    return res.json({ success: true, data: estate });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getPlatformStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalEstates,
      totalManagers,
      totalResidents,
      totalSecurity,
      totalVisitors,
      visitorsToday,
      totalUnits,
      openAlerts,
    ] = await Promise.all([
      Estate.countDocuments(),
      User.countDocuments({ role: 'estate_manager' }),
      User.countDocuments({ role: 'resident', isActive: true }),
      User.countDocuments({ role: 'security', isActive: true }),
      Visitor.countDocuments(),
      Visitor.countDocuments({ expectedDate: { $gte: today } }),
      Unit.countDocuments(),
      Alert.countDocuments({ status: 'open' }),
    ]);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const estateGrowth = await Estate.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    return res.json({
      success: true,
      data: {
        totalEstates, totalManagers, totalResidents, totalSecurity,
        totalVisitors, visitorsToday, totalUnits, openAlerts, estateGrowth,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEstateStats = async (req, res) => {
  try {
    const estateId = req.estateId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalResidents,
      activeVisitors,
      todaysVisitors,
      openAlerts,
      totalUnits,
    ] = await Promise.all([
      User.countDocuments({ estateId, role: 'resident', isActive: true }),
      Visitor.countDocuments({ estateId, status: 'checked-in' }),
      Visitor.countDocuments({ estateId, expectedDate: { $gte: today } }),
      Alert.countDocuments({ estateId, status: 'open' }),
      Unit.countDocuments({ estateId }),
    ]);

    return res.json({
      success: true,
      data: { totalResidents, activeVisitors, todaysVisitors, openAlerts, totalUnits },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
