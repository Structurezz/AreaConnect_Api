const Visitor = require('../models/Visitor');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const { generateQRCode, generateVisitorCode } = require('../services/qrService');
const { sendVisitorPass } = require('../services/emailService');
const { sendVisitorCodeSMS } = require('../services/smsService');
const { emitVisitorUpdate, emitEarlyArrival, emitEarlyApproved } = require('../services/socketService');

const EARLY_GRACE_MIN = 30; // minutes allowed before expectedDate without host approval

/** Generate a unique visitor code (retry on collision) */
const makeUniqueCode = async () => {
  for (let i = 0; i < 5; i++) {
    const code = generateVisitorCode();
    const exists = await Visitor.findOne({ visitorCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique code');
};

exports.preRegisterVisitor = async (req, res) => {
  try {
    const { visitorName, visitorPhone, visitorEmail, purpose, expectedDate, expectedDuration, notes } = req.body;
    const estateId = req.estateId;
    const resident = req.user;

    const visitorCode = await makeUniqueCode();
    const qrCodeUrl = await generateQRCode(visitorCode);

    const visitor = await Visitor.create({
      estateId,
      hostResidentId: resident._id,
      hostUnitId: resident.unitId,
      visitorName,
      visitorPhone,
      visitorEmail,
      purpose,
      expectedDate: new Date(expectedDate),
      expectedDuration: expectedDuration || 60,
      visitorCode,
      qrCodeUrl,
      notes,
      status: 'active',
    });

    const populated = await visitor.populate('hostResidentId', 'name unitId');

    // Send visitor pass via email/SMS (non-blocking)
    const estate = await require('../models/Estate').findById(estateId).select('name');
    const estateName = estate?.name || 'Estate';

    if (visitorEmail) {
      sendVisitorPass({
        to: visitorEmail,
        visitorName,
        hostName: resident.name,
        code: visitorCode,
        qrCodeUrl,
        expectedDate,
        estateName,
      }).catch(console.error);
    }

    if (visitorPhone) {
      sendVisitorCodeSMS({
        to: visitorPhone,
        visitorName,
        code: visitorCode,
        estateName,
        expectedDate,
      }).catch(console.error);
    }

    return res.status(201).json({
      success: true,
      message: 'Visitor pre-registered successfully',
      data: visitor,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getVisitors = async (req, res) => {
  try {
    const estateId = req.estateId;
    const { status, date, unit, page = 1, limit = 20 } = req.query;

    const filter = { estateId };
    if (status) filter.status = status;
    if (unit) filter.hostUnitId = unit;
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      filter.expectedDate = { $gte: d, $lt: next };
    }

    // Residents see only their own visitors
    if (req.user.role === 'resident') {
      filter.hostResidentId = req.user._id;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [visitors, total] = await Promise.all([
      Visitor.find(filter)
        .populate('hostResidentId', 'name')
        .populate('hostUnitId', 'unitNumber block')
        .populate('verifiedBySecurityId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Visitor.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: visitors,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyVisitorCode = async (req, res) => {
  try {
    const { code } = req.params;
    const visitor = await Visitor.findOne({ visitorCode: code.toUpperCase() })
      .populate('hostResidentId', 'name phone')
      .populate('hostUnitId', 'unitNumber block')
      .populate('estateId', 'name');

    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Invalid visitor code' });
    }

    if (visitor.status === 'blacklisted') {
      return res.status(403).json({ success: false, message: 'Visitor is blacklisted', data: visitor });
    }

    if (visitor.status === 'expired') {
      return res.status(410).json({ success: false, message: 'Visitor pass has expired', data: visitor });
    }

    if (visitor.status === 'checked-out') {
      return res.status(409).json({ success: false, message: 'Visitor already checked out', data: visitor });
    }

    // Detect early arrival (> 30 min before expectedDate, not yet checked in).
    // We ping the host so they can grant early entry without the guard having
    // to call them. If approval already granted, fall through to normal flow.
    const now = new Date();
    const expectedAt = new Date(visitor.expectedDate);
    const minsEarly = Math.ceil((expectedAt - now) / 60000);

    if (
      minsEarly > EARLY_GRACE_MIN &&
      !visitor.earlyEntryApproved &&
      visitor.status !== 'checked-in'
    ) {
      const hostId = visitor.hostResidentId?._id || visitor.hostResidentId;
      emitEarlyArrival(hostId?.toString(), {
        visitorId:    visitor._id,
        visitorName:  visitor.visitorName,
        visitorPhone: visitor.visitorPhone,
        visitorCode:  visitor.visitorCode,
        purpose:      visitor.purpose,
        expectedDate: visitor.expectedDate,
        minsEarly,
        estateId:     visitor.estateId?._id || visitor.estateId,
      });
      return res.json({
        success: true,
        state: 'early_arrival',
        data: visitor,
        minsEarly,
      });
    }

    return res.json({ success: true, data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.approveEarlyEntry = async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });

    // Only the host of this visitor can approve
    const hostId = visitor.hostResidentId?.toString();
    if (hostId !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the host can approve early entry' });
    }

    visitor.earlyEntryApproved   = true;
    visitor.earlyEntryApprovedBy = req.user._id;
    visitor.earlyEntryApprovedAt = new Date();
    await visitor.save();
    await visitor.populate([
      { path: 'hostResidentId', select: 'name phone' },
      { path: 'hostUnitId',     select: 'unitNumber block' },
    ]);

    const estateId = (visitor.estateId?._id || visitor.estateId)?.toString();
    emitEarlyApproved(estateId, {
      visitorId:   visitor._id,
      visitorCode: visitor.visitorCode,
      visitorName: visitor.visitorName,
      approvedBy:  req.user.name,
      visitor,
    });

    return res.json({ success: true, message: 'Early entry approved', data: visitor });
  } catch (err) {
    console.error('approveEarlyEntry error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.checkIn = async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    if (visitor.status === 'checked-in') {
      return res.status(409).json({ success: false, message: 'Already checked in' });
    }

    const now = new Date();
    const expectedAt = new Date(visitor.expectedDate);
    const duration = visitor.expectedDuration || 720; // minutes
    const expiresAt = new Date(expectedAt.getTime() + duration * 60 * 1000);

    // Too early — visitor not yet expected, and no host approval yet
    if (now < expectedAt && !visitor.earlyEntryApproved) {
      const diffMs = expectedAt - now;
      const diffMins = Math.ceil(diffMs / 60000);
      if (diffMins > EARLY_GRACE_MIN) {
        const hrs  = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        const when = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
        return res.status(425).json({
          success: false,
          code: 'TOO_EARLY',
          message: `Visitor is expected at ${expectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${when} from now. The resident has been pinged to approve early entry.`,
        });
      }
    }

    // Pass expired
    if (now > expiresAt) {
      visitor.status = 'expired';
      await visitor.save();
      return res.status(410).json({
        success: false,
        code: 'PASS_EXPIRED',
        message: 'This visitor pass has expired.',
      });
    }

    visitor.status = 'checked-in';
    visitor.entryTime = now;
    visitor.verifiedBySecurityId = req.user._id;
    await visitor.save();

    await SecurityLog.create({
      estateId: visitor.estateId,
      action: 'visitor_entry',
      visitorId: visitor._id,
      performedBy: req.user._id,
    });

    emitVisitorUpdate(visitor.estateId.toString(), visitor);

    return res.json({ success: true, message: 'Visitor checked in', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });

    visitor.status = 'checked-out';
    visitor.exitTime = new Date();
    await visitor.save();

    await SecurityLog.create({
      estateId: visitor.estateId,
      action: 'visitor_exit',
      visitorId: visitor._id,
      performedBy: req.user._id,
    });

    emitVisitorUpdate(visitor.estateId.toString(), visitor);

    return res.json({ success: true, message: 'Visitor checked out', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.blacklistVisitor = async (req, res) => {
  try {
    const visitor = await Visitor.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { status: 'blacklisted' },
      { new: true }
    );
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    return res.json({ success: true, message: 'Visitor blacklisted', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getVisitorById = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId })
      .populate('hostResidentId', 'name phone')
      .populate('hostUnitId', 'unitNumber block')
      .populate('verifiedBySecurityId', 'name');
    if (!visitor) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
