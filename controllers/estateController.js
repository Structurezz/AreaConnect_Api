const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');
const pdfParse = require('pdf-parse');
const { geocodeAddress } = require('../services/geocoding');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Unit = require('../models/Unit');
const Visitor = require('../models/Visitor');
const Alert = require('../models/Alert');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

const CONSTITUTION_BUCKET = 'constitutions';

// Constitution files are served at /files/{gridfsId}; pull the id back out.
const gridfsIdFromUrl = (url) => {
  const match = /\/files\/([a-f0-9]{24})/i.exec(url || '');
  if (!match) return null;
  try { return new ObjectId(match[1]); } catch { return null; }
};

const deleteConstitutionFile = async (gridfsId) => {
  const db = mongoose.connection?.db;
  if (!db || !gridfsId) return;
  try {
    const bucket = new GridFSBucket(db, { bucketName: CONSTITUTION_BUCKET });
    await bucket.delete(gridfsId);
  } catch (err) {
    // File may already be gone — don't block the upload/delete flow on cleanup.
    if (err?.message && !/FileNotFound/i.test(err.message)) {
      console.warn('[constitution] GridFS delete failed:', err.message);
    }
  }
};

exports.createEstate = async (req, res) => {
  try {
    const { name, address, managerId } = req.body;

    const location = {};
    const geo = await geocodeAddress(address);
    if (geo) Object.assign(location, geo, { geocodedAt: new Date() });

    const estate = await Estate.create({ name, address, managerId, location });

    if (managerId) {
      await User.findByIdAndUpdate(managerId, {
        role: 'estate_manager',
        estateId: estate._id,
      });
    }

    // Seed a 14-day trial subscription so the estate shows up on the admin
    // Subscriptions page immediately (mirrors addEstate / auth register flow).
    const plan = await Plan.findOne({ slug: 'starter', isActive: true })
      || await Plan.findOne({ isActive: true }).sort({ sortOrder: 1 });
    if (plan) {
      const trialEndsAt = new Date(Date.now() + 14 * 86400000);
      await Subscription.create({
        estateId: estate._id,
        planId: plan._id,
        billingModel: 'flat',
        cycle: 'monthly',
        status: 'trial',
        trialEndsAt,
        nextBillingDate: trialEndsAt,
        startDate: new Date(),
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
      // Phone is used by the Estates list card for the manager call link.
      .populate('managerId', 'name email phone')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: estates });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/estates/overview — super admin
// Returns one row per estate with aggregated activity so the list page
// can show plan + status + residents + units + visitors + alerts without
// doing a dozen client-side fetches.
exports.getEstatesOverview = async (req, res) => {
  try {
    const Subscription = require('../models/Subscription');
    const Visitor      = require('../models/Visitor');
    const Alert        = require('../models/Alert');

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const weekAgo    = new Date(now.getTime() - 7 * 86400000);

    const [estates, subs, residentCounts, unitCounts, visitorsToday, visitorsWeek, openAlerts] = await Promise.all([
      Estate.find()
        .populate('managerId', 'name email phone')
        .sort({ createdAt: -1 })
        .lean(),
      Subscription.find()
        .populate('planId', 'name slug color price')
        .populate('comp.planId', 'name slug color')
        .select('estateId planId status cycle nextBillingDate trialEndsAt comp lastRenewalError renewalAttempts paystackAuth.cardLast4 paystackAuth.authorizationCode')
        .lean(),
      User.aggregate([
        { $match: { role: 'resident', isActive: true } },
        { $group: { _id: '$estateId', count: { $sum: 1 } } },
      ]),
      // Lazy require to avoid circular deps
      require('../models/Unit').aggregate([
        { $group: { _id: '$estateId', count: { $sum: 1 } } },
      ]),
      Visitor.aggregate([
        { $match: { createdAt: { $gte: startOfDay } } },
        { $group: { _id: '$estateId', count: { $sum: 1 } } },
      ]),
      Visitor.aggregate([
        { $match: { createdAt: { $gte: weekAgo } } },
        { $group: { _id: '$estateId', count: { $sum: 1 } } },
      ]),
      Alert.aggregate([
        { $match: { status: { $in: ['open', 'acknowledged'] } } },
        { $group: { _id: '$estateId', count: { $sum: 1 } } },
      ]),
    ]);

    const toMap = (arr) => arr.reduce((m, r) => { m[String(r._id)] = r.count; return m; }, {});
    const subByEstate = subs.reduce((m, s) => { m[String(s.estateId)] = s; return m; }, {});
    const residents  = toMap(residentCounts);
    const units      = toMap(unitCounts);
    const vToday     = toMap(visitorsToday);
    const vWeek      = toMap(visitorsWeek);
    const alerts     = toMap(openAlerts);

    const data = estates.map(e => {
      const sub = subByEstate[String(e._id)] || null;
      const compLive = sub && sub.comp?.isActive && sub.comp?.planId &&
        (!sub.comp?.expiresAt || new Date(sub.comp.expiresAt) > now);
      return {
        ...e,
        subscription: sub ? {
          planId: sub.planId,
          status: sub.status,
          cycle:  sub.cycle,
          nextBillingDate: sub.nextBillingDate,
          trialEndsAt:     sub.trialEndsAt,
          compActive:      !!compLive,
          compPlan:        compLive ? sub.comp.planId : null,
          compExpiresAt:   compLive ? sub.comp.expiresAt : null,
          renewalIssue:    !!(sub.renewalAttempts > 0 && sub.lastRenewalError),
          renewalError:    sub.lastRenewalError || null,
          hasCard:         !!sub.paystackAuth?.authorizationCode,
          cardLast4:       sub.paystackAuth?.cardLast4 || null,
        } : null,
        counts: {
          residents:     residents[String(e._id)]  || 0,
          units:         units[String(e._id)]      || 0,
          visitorsToday: vToday[String(e._id)]     || 0,
          visitorsWeek:  vWeek[String(e._id)]      || 0,
          openAlerts:    alerts[String(e._id)]     || 0,
        },
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getEstatesOverview]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEstate = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.estateId)
      .populate('managerId', 'name email phone');
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });

    // Lazy backfill: if the estate has an address but no lat/lng yet, geocode inline
    // so existing records get map coordinates the first time anyone views them.
    if (estate.address && !estate.location?.lat && process.env.GOOGLE_MAPS_API_KEY) {
      const geo = await geocodeAddress(estate.address);
      if (geo) {
        estate.location = { ...geo, geocodedAt: new Date() };
        estate.save().catch(err => console.warn('lazy geocode save failed:', err.message));
      }
    }

    return res.json({ success: true, data: estate });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getEstateDetail = async (req, res) => {
  try {
    const { estateId } = req.params;
    const Subscription = require('../models/Subscription');
    const Visitor      = require('../models/Visitor');
    const Alert        = require('../models/Alert');
    const Announcement = require('../models/Announcement');
    const Payment      = require('../models/Payment');

    const [estate, residents, securityStaff, units, subscription, visitors, alerts, announcements, payments] = await Promise.all([
      Estate.findById(estateId).populate('managerId', 'name email phone'),
      User.find({ estateId, role: 'resident' })
        .populate('unitId', 'unitNumber block type')
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 }),
      User.find({ estateId, role: 'security' })
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 }),
      Unit.find({ estateId }).sort({ unitNumber: 1 }),
      // Replace the client's N+1: ship the single sub for this estate directly
      Subscription.findOne({ estateId })
        .populate('planId', 'name slug color price features')
        .populate('comp.planId', 'name slug color price')
        .populate('comp.grantedBy', 'name email'),
      // Last 20 visitors
      Visitor.find({ estateId })
        .sort({ createdAt: -1 }).limit(20)
        .select('name phone hostName unitNumber status checkInTime checkOutTime createdAt accessCode')
        .lean(),
      // Open + recent alerts
      Alert.find({ estateId })
        .sort({ createdAt: -1 }).limit(20)
        .populate('residentId', 'name phone')
        .populate('unitId', 'unitNumber block')
        .lean(),
      // Last 10 announcements
      Announcement.find({ estateId })
        .sort({ createdAt: -1 }).limit(10)
        .select('title message category isPinned createdAt')
        .lean(),
      // Last 20 payments (if the schedule model exists)
      Payment.find({ estateId })
        .sort({ createdAt: -1 }).limit(20)
        .populate('residentId', 'name')
        .populate('scheduleId', 'title amount')
        .lean().catch(() => []),
    ]);

    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });

    return res.json({
      success: true,
      data: {
        estate,
        residents,
        securityStaff,
        units,
        subscription,
        visitors,
        alerts,
        announcements,
        payments,
      },
    });
  } catch (err) {
    console.error('[getEstateDetail]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateEstate = async (req, res) => {
  try {
    const { name, address, settings, location: manualLocation } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (settings !== undefined) update.settings = settings;

    // Tracks what happened with geocoding so the client can show the right toast.
    //   'manual'    — manager/admin dropped a pin by hand, we trust that
    //   'success'   — Google returned a lat/lng for the new address
    //   'failed'    — address changed but Google returned nothing (quota, bad address, etc.)
    //   'skipped'   — address didn't change
    //   'not_configured' — GOOGLE_MAPS_API_KEY missing
    let geocodeOutcome = 'skipped';

    // Manual pin override (from Settings map picker) takes precedence over geocoding
    if (manualLocation && typeof manualLocation.lat === 'number' && typeof manualLocation.lng === 'number') {
      update.location = {
        lat: manualLocation.lat,
        lng: manualLocation.lng,
        formattedAddress: manualLocation.formattedAddress || address || '',
        placeId: manualLocation.placeId || '',
        geocodedAt: new Date(),
      };
      if (manualLocation.formattedAddress) update.address = manualLocation.formattedAddress;
      else if (address !== undefined) update.address = address;
      geocodeOutcome = 'manual';
    } else if (address !== undefined) {
      update.address = address;
      // Re-geocode when address changed and no manual pin provided
      const current = await Estate.findById(req.params.estateId).select('address').lean();
      if (current && current.address !== address) {
        if (!process.env.GOOGLE_MAPS_API_KEY) {
          console.warn('[updateEstate] GOOGLE_MAPS_API_KEY missing — pin will stay stale');
          geocodeOutcome = 'not_configured';
        } else {
          const geo = await geocodeAddress(address);
          if (geo) {
            update.location = { ...geo, geocodedAt: new Date() };
            geocodeOutcome = 'success';
            console.log(`[updateEstate] geocoded "${address}" → ${geo.lat},${geo.lng}`);
          } else {
            geocodeOutcome = 'failed';
            console.warn(`[updateEstate] geocoding returned nothing for "${address}"`);
          }
        }
      }
    }

    const estate = await Estate.findByIdAndUpdate(
      req.params.estateId,
      update,
      { new: true, runValidators: true }
    );
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    return res.json({ success: true, data: estate, geocode: geocodeOutcome });
  } catch (err) {
    console.error('updateEstate error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getPlatformStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo    = new Date(Date.now() - 7  * 86400000);
    const thirtyAgo  = new Date(Date.now() - 30 * 86400000);
    const Payment    = require('../models/Payment');

    const [
      totalEstates, activeEstates,
      totalManagers, totalResidents, totalSecurity,
      totalVisitors, visitorsToday, visitorsWeek,
      totalUnits, occupiedUnits,
      openAlerts,
      dau, wau, mau,
      paymentVolumeAllTime, paymentVolume30d,
    ] = await Promise.all([
      Estate.countDocuments(),
      Estate.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'estate_manager' }),
      User.countDocuments({ role: 'resident', isActive: true }),
      User.countDocuments({ role: 'security', isActive: true }),
      Visitor.countDocuments(),
      Visitor.countDocuments({ createdAt: { $gte: today } }),
      Visitor.countDocuments({ createdAt: { $gte: weekAgo } }),
      Unit.countDocuments(),
      Unit.countDocuments({ status: 'occupied' }),
      Alert.countDocuments({ status: 'open' }),
      // DAU/WAU/MAU based on lastSeen
      User.countDocuments({ lastSeen: { $gte: today    } }),
      User.countDocuments({ lastSeen: { $gte: weekAgo  } }),
      User.countDocuments({ lastSeen: { $gte: thirtyAgo } }),
      // Payment volume (service-charge collection)
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).catch(() => []),
      Payment.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: thirtyAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).catch(() => []),
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

    const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    return res.json({
      success: true,
      data: {
        totalEstates, activeEstates,
        totalManagers, totalResidents, totalSecurity,
        totalVisitors, visitorsToday, visitorsWeek,
        totalUnits, occupiedUnits, occupancyRate,
        openAlerts, estateGrowth,
        dau, wau, mau,
        paymentVolume: paymentVolumeAllTime[0]?.total || 0,
        paymentVolume30d: paymentVolume30d[0]?.total || 0,
      },
    });
  } catch (err) {
    console.error('[getPlatformStats]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMyEstates = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('managedEstates estateId');

    // Union: estates in managedEstates array + any estate where this user is managerId
    // This handles managers who registered before the managedEstates field was added
    const estates = await Estate.find({
      $or: [
        { _id: { $in: user.managedEstates } },
        { managerId: userId },
      ],
    })
      .select('name address estateCode logoUrl isActive createdAt')
      .lean();

    // Backfill managedEstates for legacy accounts that are missing entries
    const estateIds = estates.map(e => e._id);
    const missing = estateIds.filter(
      id => !user.managedEstates.some(m => m.toString() === id.toString())
    );
    if (missing.length > 0) {
      await User.findByIdAndUpdate(userId, { $addToSet: { managedEstates: { $each: missing } } });
    }

    const activeId = user.estateId?.toString();
    const result = estates.map(e => ({ ...e, isActive: e._id.toString() === activeId }));
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.addEstate = async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name || !address) {
      return res.status(400).json({ success: false, message: 'Name and address are required' });
    }

    const managerId = req.user._id;
    const location = {};
    const geo = await geocodeAddress(address);
    if (geo) Object.assign(location, geo, { geocodedAt: new Date() });

    const estate = await Estate.create({ name, address, managerId, location });

    await User.findByIdAndUpdate(managerId, {
      $addToSet: { managedEstates: estate._id },
    });

    // Start 14-day trial on starter/growth plan
    const plan = await Plan.findOne({ slug: 'starter', isActive: true })
      || await Plan.findOne({ isActive: true }).sort({ sortOrder: 1 });
    if (plan) {
      const trialEndsAt = new Date(Date.now() + 14 * 86400000);
      await Subscription.create({
        estateId: estate._id,
        planId: plan._id,
        billingModel: 'flat',
        cycle: 'monthly',
        status: 'trial',
        trialEndsAt,
        nextBillingDate: trialEndsAt,
        startDate: new Date(),
      });
    }

    return res.status(201).json({ success: true, message: 'Estate created', data: estate });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Constitution PDF ─────────────────────────────────────────────────────────

function assertEstateAccess(user, estate) {
  if (user.role === 'super_admin') return true;
  if (user.role === 'estate_manager') {
    if (estate.managerId?.toString() === user._id.toString()) return true;
    if ((user.managedEstates || []).some(id => id.toString() === estate._id.toString())) return true;
  }
  return user.estateId?.toString() === estate._id.toString();
}

// POST /estates/:estateId/geocode — force re-geocode this estate's address
exports.geocodeEstate = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.estateId);
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    if (!estate.address) return res.status(400).json({ success: false, message: 'Estate has no address to geocode' });

    const geo = await geocodeAddress(estate.address);
    if (!geo) return res.status(422).json({ success: false, message: 'Address could not be geocoded' });

    estate.location = { ...geo, geocodedAt: new Date() };
    await estate.save();
    return res.json({ success: true, data: estate.location });
  } catch (err) {
    console.error('geocodeEstate error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.uploadConstitution = async (req, res) => {
  try {
    const { estateId } = req.params;
    const estate = await Estate.findById(estateId);
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });

    const isManager = req.user.role === 'super_admin'
      || estate.managerId?.toString() === req.user._id.toString()
      || (req.user.managedEstates || []).some(id => id.toString() === estateId);
    if (!isManager) return res.status(403).json({ success: false, message: 'Only the estate manager can upload the constitution' });

    if (!req.file) return res.status(400).json({ success: false, message: 'PDF file required' });

    // Parse PDF text for AI grounding. Upload middleware uses memory storage
    // then streams to GridFS, so the bytes live in req.file.buffer (no disk path).
    let extractedText = '';
    let pageCount = 0;
    try {
      const parsed = await pdfParse(req.file.buffer);
      extractedText = (parsed.text || '').trim();
      pageCount = parsed.numpages || 0;
    } catch (parseErr) {
      console.error('constitution parse error:', parseErr.message);
      return res.status(400).json({ success: false, message: 'Could not read the PDF. Please ensure it is a valid, non-encrypted PDF.' });
    }

    // Delete previous constitution from GridFS so files don't accumulate.
    if (estate.constitution?.fileUrl) {
      await deleteConstitutionFile(gridfsIdFromUrl(estate.constitution.fileUrl));
    }

    estate.constitution = {
      fileUrl: req.file.url,
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      uploadedAt: new Date(),
      uploadedById: req.user._id,
      extractedText,
      pageCount,
    };
    await estate.save();

    return res.json({
      success: true,
      message: 'Constitution uploaded and indexed for the AI court.',
      data: {
        fileName: estate.constitution.fileName,
        fileUrl: estate.constitution.fileUrl,
        sizeBytes: estate.constitution.sizeBytes,
        uploadedAt: estate.constitution.uploadedAt,
        pageCount: estate.constitution.pageCount,
        textLength: extractedText.length,
      },
    });
  } catch (err) {
    console.error('uploadConstitution error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.getConstitutionMeta = async (req, res) => {
  try {
    const { estateId } = req.params;
    const estate = await Estate.findById(estateId).select('constitution managerId name');
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    if (!assertEstateAccess(req.user, estate)) return res.status(403).json({ success: false, message: 'Forbidden' });

    const c = estate.constitution || {};
    return res.json({
      success: true,
      data: {
        hasConstitution: !!c.fileUrl,
        fileName: c.fileName || '',
        fileUrl: c.fileUrl || '',
        sizeBytes: c.sizeBytes || 0,
        pageCount: c.pageCount || 0,
        uploadedAt: c.uploadedAt || null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.downloadConstitution = async (req, res) => {
  try {
    const { estateId } = req.params;
    const estate = await Estate.findById(estateId).select('constitution managerId name');
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    if (!assertEstateAccess(req.user, estate)) return res.status(403).json({ success: false, message: 'Forbidden' });
    if (!estate.constitution?.fileUrl) return res.status(404).json({ success: false, message: 'No constitution uploaded' });

    const gridfsId = gridfsIdFromUrl(estate.constitution.fileUrl);
    if (!gridfsId) return res.status(404).json({ success: false, message: 'File missing on server' });

    const db = mongoose.connection?.db;
    if (!db) return res.status(503).json({ success: false, message: 'DB not ready' });

    const bucket = new GridFSBucket(db, { bucketName: CONSTITUTION_BUCKET });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${estate.constitution.fileName || 'constitution.pdf'}"`);
    const stream = bucket.openDownloadStream(gridfsId);
    stream.on('error', (err) => {
      if (/FileNotFound/i.test(err?.message || '')) {
        if (!res.headersSent) res.status(404).json({ success: false, message: 'File missing on server' });
      } else {
        console.error('[constitution] download stream error:', err?.message);
        if (!res.headersSent) res.status(500).end();
      }
    });
    return stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteConstitution = async (req, res) => {
  try {
    const { estateId } = req.params;
    const estate = await Estate.findById(estateId);
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });

    const isManager = req.user.role === 'super_admin'
      || estate.managerId?.toString() === req.user._id.toString()
      || (req.user.managedEstates || []).some(id => id.toString() === estateId);
    if (!isManager) return res.status(403).json({ success: false, message: 'Only the estate manager can remove the constitution' });

    if (estate.constitution?.fileUrl) {
      await deleteConstitutionFile(gridfsIdFromUrl(estate.constitution.fileUrl));
    }
    estate.constitution = { fileUrl: '', fileName: '', sizeBytes: 0, uploadedAt: undefined, uploadedById: undefined, extractedText: '', pageCount: 0 };
    await estate.save();
    return res.json({ success: true, message: 'Constitution removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
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
