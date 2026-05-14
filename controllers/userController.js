const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Estate = require('../models/Estate');

exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, estateId } = req.body;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, phone, passwordHash, role, estateId: estateId || null });

    if (role === 'estate_manager' && estateId) {
      await Estate.findByIdAndUpdate(estateId, { managerId: user._id });
    }

    return res.status(201).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, estateId, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (estateId) filter.estateId = estateId;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const users = await User.find(filter)
      .select('-passwordHash -refreshToken')
      .populate('estateId', 'name estateCode')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: users });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'isActive', 'role', 'estateId'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .select('-passwordHash -refreshToken')
      .populate('estateId', 'name estateCode');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
