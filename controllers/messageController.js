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
    const { receiverId, to, isGroupMessage } = req.body;
    const recipient = receiverId || to;
    // Multipart bodies send booleans as strings
    const isGroup = isGroupMessage === true || isGroupMessage === 'true';
    const content = String(req.body.content || '').slice(0, 4000);
    const sticker = /^[a-z0-9_-]{1,40}$/i.test(req.body.sticker || '') ? req.body.sticker : '';
    const file = req.chatFile || null;
    const legacyImage = req.chatImage || req.file || null;

    if (!content.trim() && !file && !legacyImage && !sticker) {
      return res.status(400).json({ success: false, message: 'Message is empty' });
    }

    // DMs only to people in the same estate (managers: any estate they run),
    // and never across a safety block.
    if (!isGroup) {
      if (!recipient || !mongoose.isValidObjectId(recipient)) return res.status(400).json({ success: false, message: 'Choose who to message' });
      const other = await User.findById(recipient).select('estateId managedEstates role').lean();
      const sameEstate = other && (String(other.estateId) === String(req.estateId)
        || (other.managedEstates || []).some((e) => String(e) === String(req.estateId))
        || other.role === 'super_admin' || req.user.role === 'super_admin');
      if (!sameEstate) return res.status(403).json({ success: false, message: "You can't message this person" });
      const block = await require('../services/safetyService').findBlockBetween(req.user._id, recipient).catch(() => null);
      if (block) return res.status(409).json({ success: false, code: 'UNAVAILABLE', message: "This person isn't available" });
    }

    const isImageFile = file && /^image\//i.test(file.mimetype);
    const message = await Message.create({
      estateId: req.estateId,
      senderId: req.user._id,
      receiverId: isGroup ? null : recipient,
      content,
      isGroupMessage: isGroup,
      // imageUrl keeps older apps showing photos sent as attachments
      imageUrl: legacyImage ? legacyImage.url : isImageFile ? file.url : '',
      attachment: file ? { url: file.url, name: file.originalname || 'file', type: file.mimetype || '', size: file.size || 0 } : undefined,
      sticker,
      readBy: [req.user._id],
    });

    await message.populate('senderId', 'name profilePhoto role');

    res.status(201).json({ success: true, data: message });

    // Real-time: DMs to the receiver, group messages to the estate (the
    // server emits these — clients no longer relay messages over the socket)
    if (!message.isGroupMessage && recipient) {
      const io = getIO();
      io?.to(`user:${recipient}`).emit('new_message', message.toObject());
    } else if (message.isGroupMessage && req.estateId) {
      emitGroupMessage(String(req.estateId), message.toObject());
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

          // Give Nkechi something to react to when the message is a sticker or file
          const said = message.content
            || (message.sticker ? `[sent a "${message.sticker.replace(/[-_]/g, ' ')}" sticker]` : '')
            || (message.attachment?.url ? `[shared a file: ${message.attachment.name}]` : '')
            || (message.imageUrl ? '[shared a photo]' : '');
          const nkechiText = await getNkechiResponse(
            recentMessages,
            said,
            req.user.name,
            estateName,
            req.estateId,
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
      // Hide users who've marked themselves invisible in the DM picker.
      // A missing field means legacy account → treat as discoverable.
      isDiscoverable: { $ne: false },
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
