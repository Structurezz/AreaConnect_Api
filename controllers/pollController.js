const Poll = require('../models/Poll');

exports.getPolls = async (req, res) => {
  try {
    const polls = await Poll.find({ estateId: req.estateId })
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: polls });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createPoll = async (req, res) => {
  try {
    const { question, options, endsAt, allowMultiple } = req.body;
    const poll = await Poll.create({
      estateId: req.estateId,
      question,
      options: (options || []).map(text => ({ text, votes: [] })),
      endsAt: endsAt || null,
      allowMultiple: allowMultiple || false,
      createdBy: req.user._id,
    });
    await poll.populate('createdBy', 'name');
    return res.status(201).json({ success: true, data: poll });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.vote = async (req, res) => {
  try {
    const { optionIndex } = req.body;
    const poll = await Poll.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!poll) return res.status(404).json({ success: false, message: 'Poll not found' });
    if (!poll.isActive) return res.status(400).json({ success: false, message: 'Poll is closed' });
    if (poll.endsAt && new Date() > poll.endsAt) {
      return res.status(400).json({ success: false, message: 'Poll has ended' });
    }
    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({ success: false, message: 'Invalid option' });
    }

    const userId = req.user._id.toString();
    const alreadyVoted = poll.options[optionIndex].votes.some(v => v.toString() === userId);

    if (alreadyVoted) {
      poll.options[optionIndex].votes = poll.options[optionIndex].votes.filter(v => v.toString() !== userId);
    } else {
      if (!poll.allowMultiple) {
        poll.options.forEach((opt, i) => {
          if (i !== optionIndex) {
            opt.votes = opt.votes.filter(v => v.toString() !== userId);
          }
        });
      }
      poll.options[optionIndex].votes.push(req.user._id);
    }

    poll.markModified('options');
    await poll.save();
    await poll.populate('createdBy', 'name');
    return res.json({ success: true, data: poll });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.closePoll = async (req, res) => {
  try {
    const poll = await Poll.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { isActive: false },
      { new: true }
    ).populate('createdBy', 'name');
    if (!poll) return res.status(404).json({ success: false, message: 'Poll not found' });
    return res.json({ success: true, data: poll });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
