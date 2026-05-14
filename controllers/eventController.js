const Event = require('../models/Event');

exports.getEvents = async (req, res) => {
  try {
    const events = await Event.find({ estateId: req.estateId, isActive: true })
      .populate('createdBy', 'name')
      .sort({ date: 1 });
    return res.json({ success: true, data: events });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const { title, description, date, time, location, organizer, isFridayFunTimes } = req.body;
    const event = await Event.create({
      estateId: req.estateId,
      title, description, date, time, location, organizer,
      isFridayFunTimes: isFridayFunTimes || false,
      createdBy: req.user._id,
    });
    await event.populate('createdBy', 'name');
    return res.status(201).json({ success: true, data: event });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.json({ success: true, data: event });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    await Event.findOneAndUpdate({ _id: req.params.id, estateId: req.estateId }, { isActive: false });
    return res.json({ success: true, message: 'Event deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.rsvp = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, estateId: req.estateId, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    const userId = req.user._id;
    const hasRsvp = event.rsvps.some(id => id.toString() === userId.toString());

    if (hasRsvp) {
      await Event.findByIdAndUpdate(req.params.id, { $pull: { rsvps: userId } });
    } else {
      await Event.findByIdAndUpdate(req.params.id, { $addToSet: { rsvps: userId } });
    }

    const updated = await Event.findById(req.params.id).populate('createdBy', 'name');
    return res.json({ success: true, data: updated, rsvped: !hasRsvp });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
