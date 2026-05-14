const Announcement = require('../models/Announcement');
const { emitAnnouncement } = require('../services/socketService');

exports.getAnnouncements = async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const filter = { estateId: req.estateId };
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const announcements = await Announcement.find(filter)
      .populate('authorId', 'name profilePhoto')
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.json({ success: true, data: announcements });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const { title, body, category, isPinned } = req.body;
    const announcement = await Announcement.create({
      estateId: req.estateId,
      authorId: req.user._id,
      title,
      body,
      category: category || 'general',
      isPinned: isPinned || false,
      imageUrl: req.file ? `/uploads/${req.file.filename}` : '',
    });

    await announcement.populate('authorId', 'name profilePhoto');
    emitAnnouncement(req.estateId.toString(), announcement);

    return res.status(201).json({ success: true, data: announcement });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateAnnouncement = async (req, res) => {
  try {
    const { title, body, category, isPinned } = req.body;
    const announcement = await Announcement.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { title, body, category, isPinned },
      { new: true }
    );
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: announcement });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    await Announcement.findOneAndDelete({ _id: req.params.id, estateId: req.estateId });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.markRead = async (req, res) => {
  try {
    await Announcement.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: req.user._id },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
