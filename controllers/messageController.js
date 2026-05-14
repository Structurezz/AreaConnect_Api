const Message = require('../models/Message');
const Estate = require('../models/Estate');
const User = require('../models/User');
const mongoose = require('mongoose');
const { getNkechiResponse } = require('../services/nkechiService');
const { emitNkechiTyping, emitGroupMessage, getIO } = require('../services/socketService');

exports.getGroupMessages = async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const filter = { estateId: req.estateId, isGroupMessage: true, isDeleted: false };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(filter)
      .populate('senderId', 'name profilePhoto role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    await Message.updateMany(
      { estateId: req.estateId, isGroupMessage: true, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    return res.json({ success: true, data: messages.reverse() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getDMMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      estateId: req.estateId,
      isGroupMessage: false,
      isDeleted: false,
      $or: [
        { senderId: myId, receiverId: userId },
        { senderId: userId, receiverId: myId },
      ],
    })
      .populate('senderId', 'name profilePhoto role')
      .sort({ createdAt: 1 })
      .limit(100);

    await Message.updateMany(
      { estateId: req.estateId, receiverId: myId, senderId: userId, readBy: { $ne: myId } },
      { $addToSet: { readBy: myId } }
    );

    return res.json({ success: true, data: messages });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    // Accept both `receiverId` (API) and `to` (Marketplace ChatPanel)
    const { receiverId, to, content, isGroupMessage } = req.body;
    const recipient = receiverId || to;

    const message = await Message.create({
      estateId: req.estateId,
      senderId: req.user._id,
      receiverId: isGroupMessage ? null : recipient,
      content,
      isGroupMessage: Boolean(isGroupMessage),
      imageUrl: req.file ? `/uploads/${req.file.filename}` : '',
      readBy: [req.user._id],
    });

    await message.populate('senderId', 'name profilePhoto role');

    res.status(201).json({ success: true, data: message });

    // Emit DM to receiver in real-time
    if (!message.isGroupMessage && recipient) {
      const io = getIO();
      io?.to(`user:${recipient}`).emit('new_message', message.toObject());
    }

    // Fire Nkechi async — don't block the response
    if (message.isGroupMessage && req.estateId) {
      setImmediate(async () => {
        try {
          const estateIdStr = req.estateId.toString();
          const estate = await Estate.findById(req.estateId).select('name');
          const estateName = estate?.name || 'the estate';

          const recentMessages = await Message.find({
            estateId: req.estateId,
            isGroupMessage: true,
            isDeleted: false,
          })
            .populate('senderId', 'name')
            .sort({ createdAt: -1 })
            .limit(15)
            .then((msgs) => msgs.reverse());

          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
          emitNkechiTyping(estateIdStr, true);

          const nkechiText = await getNkechiResponse(
            recentMessages,
            message.content,
            req.user.name,
            estateName,
          );

          emitNkechiTyping(estateIdStr, false);

          if (nkechiText) {
            const nkechiMsg = await Message.create({
              estateId: req.estateId,
              isNkechi: true,
              content: nkechiText,
              isGroupMessage: true,
              readBy: [],
            });
            emitGroupMessage(estateIdStr, { ...nkechiMsg.toObject(), isNkechi: true });
          }
        } catch (e) {
          console.error('[Nkechi] failed:', e.message);
          emitNkechiTyping(req.estateId.toString(), false);
        }
      });
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
};

exports.getUnreadCounts = async (req, res) => {
  try {
    const myId = req.user._id;
    const [groupUnread, dmUnread] = await Promise.all([
      Message.countDocuments({
        estateId: req.estateId,
        isGroupMessage: true,
        readBy: { $ne: myId },
        senderId: { $ne: myId },
      }),
      Message.countDocuments({
        estateId: req.estateId,
        isGroupMessage: false,
        receiverId: myId,
        readBy: { $ne: myId },
      }),
    ]);
    return res.json({ success: true, data: { group: groupUnread, dm: dmUnread } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getConversations = async (req, res) => {
  try {
    const myId = new mongoose.Types.ObjectId(req.user._id);
    const estateId = new mongoose.Types.ObjectId(req.estateId);

    const convos = await Message.aggregate([
      {
        $match: {
          estateId,
          isGroupMessage: false,
          isDeleted: false,
          $or: [{ senderId: myId }, { receiverId: myId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            // group by the OTHER person in the conversation
            $cond: [{ $eq: ['$senderId', myId] }, '$receiverId', '$senderId'],
          },
          lastMessage: { $first: '$$ROOT' },
          unread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', myId] },
                    { $not: { $in: [myId, { $ifNull: ['$readBy', []] }] } },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partner',
        },
      },
      { $unwind: { path: '$partner', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: 1,
          lastMessage: { content: 1, createdAt: 1 },
          unread: 1,
          partner: { _id: 1, name: 1, role: 1, profilePhoto: 1 },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    return res.json({ success: true, data: convos });
  } catch (err) {
    console.error('[getConversations]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Returns all users in the same estate (for DM picker)
exports.getEstateUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {
      estateId: req.estateId,
      isActive: true,
      _id: { $ne: req.user._id },
    };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ];
    }
    const users = await User.find(filter)
      .select('_id name role profilePhoto')
      .limit(25)
      .sort({ name: 1 });
    return res.json({ success: true, data: users });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
