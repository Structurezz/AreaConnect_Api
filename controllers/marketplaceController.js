const mongoose = require('mongoose');
const MarketplaceListing = require('../models/MarketplaceListing');
const MarketplaceSettings = require('../models/MarketplaceSettings');
const MarketplaceReport = require('../models/MarketplaceReport');
const MarketplaceReview = require('../models/MarketplaceReview');
const { emitNotification, getIO } = require('../services/socketService');

const SELLER = 'name profilePhoto phone';
const isManager = (u) => ['estate_manager', 'super_admin'].includes(u?.role);
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });

// Ping every estate manager (staff room) — new items to review, reports.
const notifyManagers = (estateId, n) => getIO()?.to(`estate:${estateId}:estate_manager`).emit('notification', {
  ...n, createdAt: new Date().toISOString(),
});
const notifySeller = (listing, title, body) => emitNotification(listing.estateId, {
  id: `mkt-${listing._id}-${Date.now()}`, type: 'marketplace', title, body,
  meta: { listingId: String(listing._id) },
}, listing.sellerId?._id || listing.sellerId);

const activeSuspension = (settings, userId) => (settings.suspendedSellers || []).find(
  (s) => String(s.userId) === String(userId) && (!s.until || s.until > new Date()),
);

// Average rating + count for a set of sellers.
async function ratingsFor(estateId, sellerIds) {
  if (!sellerIds.length) return {};
  const rows = await MarketplaceReview.aggregate([
    { $match: { estateId: new mongoose.Types.ObjectId(String(estateId)), sellerId: { $in: sellerIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $group: { _id: '$sellerId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), { avg: Math.round(r.avg * 10) / 10, count: r.count }]));
}
async function withRatings(estateId, listings) {
  const ids = [...new Set(listings.map((l) => String(l.sellerId?._id || l.sellerId)))];
  const map = await ratingsFor(estateId, ids);
  return listings.map((l) => {
    const o = l.toObject ? l.toObject() : l;
    o.sellerRating = map[String(o.sellerId?._id || o.sellerId)] || { avg: 0, count: 0 };
    return o;
  });
}

// Median price of comparable live listings (same category) — used to spot gouging.
async function categoryMedian(estateId, category, excludeId) {
  const q = { estateId, category, status: 'active', price: { $gt: 0 } };
  if (excludeId) q._id = { $ne: excludeId };
  const prices = (await MarketplaceListing.find(q).select('price').lean()).map((l) => l.price).sort((a, b) => a - b);
  if (prices.length < 3) return null; // not enough to judge
  const m = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[m] : (prices[m - 1] + prices[m]) / 2;
}

/**
 * Consumer-protection checks for a listing about to go live.
 * Returns { error } to refuse outright, or { flags } (non-empty = hold for review).
 */
async function vet(settings, { estateId, sellerId, title, description, price, category, excludeId, counting }) {
  const sus = activeSuspension(settings, sellerId);
  if (sus) return { error: `Your marketplace access is suspended${sus.until ? ` until ${sus.until.toDateString()}` : ''}${sus.reason ? `: ${sus.reason}` : ''}.`, code: 403 };

  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const banned = (settings.bannedWords || []).find((w) => w && new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text));
  if (banned) return { error: `"${banned}" isn't allowed on this estate's marketplace.` };

  const cap = settings.priceCaps?.[category];
  if (cap != null && cap > 0 && price > cap) {
    return { error: `Estate management caps ${category.replace(/_/g, ' ')} at ${naira(cap)}. Lower your price to list.`, cap };
  }

  if (counting) {
    const live = await MarketplaceListing.countDocuments({ estateId, sellerId, status: { $in: ['active', 'pending_approval'] }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (live >= settings.maxActivePerSeller) return { error: `You can have at most ${settings.maxActivePerSeller} live listings. Mark some as sold first.` };
  }

  const flags = [];
  if (settings.outlierMultiplier > 0 && price > 0) {
    const median = await categoryMedian(estateId, category, excludeId);
    if (median && price > median * settings.outlierMultiplier) {
      flags.push({ type: 'price_outlier', detail: `${naira(price)} is over ${settings.outlierMultiplier}× the typical ${naira(median)} for this category` });
    }
  }
  if (settings.requireApproval) flags.push({ type: 'approval_required', detail: 'Estate requires approval for new listings' });
  return { flags };
}

function holdOrPublish(listing, flags) {
  listing.flags = flags;
  listing.status = flags.length ? 'pending_approval' : 'active';
  listing.moderation = { reason: '', by: null, at: null };
}

function announceHeld(listing, sellerName) {
  if (listing.status !== 'pending_approval') return;
  notifyManagers(listing.estateId, {
    id: `mkt-review-${listing._id}`, type: 'marketplace_review',
    title: 'Marketplace listing to review',
    body: `${sellerName || 'A resident'}: "${listing.title}" — ${listing.flags.map((f) => f.detail).join('; ')}`,
    meta: { listingId: String(listing._id) },
  });
}

// ─────────────────────────── Residents ───────────────────────────

exports.getListings = async (req, res) => {
  try {
    const { category, page = 1, limit = 20, q, condition, minPrice, maxPrice, sort = 'newest' } = req.query;
    // Residents only ever browse live (or sold) items.
    const status = ['active', 'sold'].includes(req.query.status) ? req.query.status : 'active';
    const filter = { estateId: req.estateId, status };
    if (category) filter.category = category;
    if (condition) filter.condition = condition;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    if (q?.trim()) {
      const re = new RegExp(escapeRe(q.trim()), 'i');
      filter.$or = [{ title: re }, { description: re }];
    }

    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, price_asc: { price: 1 }, price_desc: { price: -1 }, popular: { views: -1 } };
    const lim = Math.min(60, parseInt(limit) || 20);
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * lim;
    const [listings, total] = await Promise.all([
      MarketplaceListing.find(filter).populate('sellerId', SELLER).sort(sortMap[sort] || sortMap.newest).skip(skip).limit(lim),
      MarketplaceListing.countDocuments(filter),
    ]);

    return res.json({ success: true, data: await withRatings(req.estateId, listings), pagination: { total, page: parseInt(page), pages: Math.ceil(total / lim) } });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.getMyListings = async (req, res) => {
  try {
    const listings = await MarketplaceListing.find({ estateId: req.estateId, sellerId: req.user._id })
      .populate('sellerId', SELLER).sort({ createdAt: -1 });
    return res.json({ success: true, data: await withRatings(req.estateId, listings) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.getSaved = async (req, res) => {
  try {
    const listings = await MarketplaceListing.find({ estateId: req.estateId, savedBy: req.user._id, status: { $in: ['active', 'sold'] } })
      .populate('sellerId', SELLER).sort({ createdAt: -1 });
    return res.json({ success: true, data: await withRatings(req.estateId, listings) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// GET /api/marketplace/rules — what residents need to know before listing.
exports.getRules = async (req, res) => {
  try {
    const s = await MarketplaceSettings.forEstate(req.estateId);
    const sus = activeSuspension(s, req.user._id);
    return res.json({ success: true, data: {
      requireApproval: s.requireApproval, priceCaps: s.priceCaps, maxActivePerSeller: s.maxActivePerSeller,
      suspended: sus ? { reason: sus.reason, until: sus.until } : null,
    } });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.createListing = async (req, res) => {
  try {
    const { title, description, price, category, contactPhone, condition, isNegotiable } = req.body;
    const images = req.files ? req.files.map((f) => f.url) : [];
    const p = Math.max(0, parseFloat(price) || 0);

    const settings = await MarketplaceSettings.forEstate(req.estateId);
    const check = await vet(settings, { estateId: req.estateId, sellerId: req.user._id, title, description, price: p, category, counting: true });
    if (check.error) return fail(res, check.code || 400, check.error, check.cap ? { cap: check.cap } : {});

    const listing = new MarketplaceListing({
      estateId: req.estateId, sellerId: req.user._id,
      title, description, price: p, category,
      condition: condition || 'good',
      isNegotiable: isNegotiable === 'true' || isNegotiable === true,
      contactPhone: contactPhone || req.user.phone || '',
      images,
      priceHistory: [{ price: p }],
    });
    holdOrPublish(listing, check.flags);
    await listing.save();
    await listing.populate('sellerId', SELLER);
    announceHeld(listing, req.user.name);
    return res.status(201).json({ success: true, data: listing, held: listing.status === 'pending_approval' });
  } catch (err) {
    console.error('[marketplace create]', err.message);
    return fail(res, 500, 'Server error');
  }
};

// Sellers edit their own listing. Status can only move between active ⇄ sold;
// anything that changes what buyers see is re-checked (and may go to review).
exports.updateListing = async (req, res) => {
  try {
    const { title, description, price, category, status, contactPhone, condition, isNegotiable } = req.body;
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return fail(res, 404, 'Not found');
    if (String(listing.sellerId) !== String(req.user._id)) return fail(res, 403, 'Only the seller can edit this listing');
    if (listing.status === 'removed') return fail(res, 403, 'Estate management removed this listing. It can\'t be edited.');

    if (status !== undefined && !['active', 'sold'].includes(status)) return fail(res, 400, 'You can only mark a listing as sold or available');

    const contentChanged = [title, description, price, category].some((v) => v !== undefined);
    if (title !== undefined) listing.title = title;
    if (description !== undefined) listing.description = description;
    if (category !== undefined) listing.category = category;
    if (contactPhone !== undefined) listing.contactPhone = contactPhone;
    if (condition !== undefined) listing.condition = condition;
    if (isNegotiable !== undefined) listing.isNegotiable = isNegotiable === 'true' || isNegotiable === true;
    if (price !== undefined) {
      const p = Math.max(0, parseFloat(price) || 0);
      if (p !== listing.price) listing.priceHistory.push({ price: p });
      listing.price = p;
    }

    const wasLive = ['active', 'pending_approval'].includes(listing.status);
    const relisting = status === 'active' && ['sold', 'rejected'].includes(listing.status);
    const editingLive = contentChanged && listing.status !== 'sold' && status !== 'sold';
    if (status === 'sold') {
      if (listing.status !== 'active') return fail(res, 409, 'Only live listings can be marked sold');
      listing.status = 'sold';
    } else if (relisting || editingLive) {
      // Re-vet edits, relists and resubmissions of rejected listings.
      const settings = await MarketplaceSettings.forEstate(req.estateId);
      const check = await vet(settings, {
        estateId: req.estateId, sellerId: req.user._id, title: listing.title, description: listing.description,
        price: listing.price, category: listing.category, excludeId: listing._id, counting: !wasLive,
      });
      if (check.error) return fail(res, check.code || 400, check.error, check.cap ? { cap: check.cap } : {});
      // A rejected listing always goes back through review.
      const flags = [...check.flags];
      if (listing.status === 'rejected' && !flags.length) flags.push({ type: 'approval_required', detail: 'Resubmitted after rejection' });
      // Editing can't release a listing that residents reported.
      if (listing.status === 'pending_approval') flags.push(...listing.flags.filter((f) => f.type === 'reported'));
      // Already-approved live listings keep running unless the edit trips a check.
      holdOrPublish(listing, flags);
    }

    await listing.save();
    await listing.populate('sellerId', SELLER);
    announceHeld(listing, req.user.name);
    return res.json({ success: true, data: listing, held: listing.status === 'pending_approval' });
  } catch (err) {
    console.error('[marketplace update]', err.message);
    return fail(res, 500, 'Server error');
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return fail(res, 404, 'Not found');
    if (String(listing.sellerId) !== String(req.user._id) && !isManager(req.user)) return fail(res, 403, 'Not authorized');
    await listing.deleteOne();
    return res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.viewListing = async (req, res) => {
  try {
    const existing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId }).select('sellerId status');
    if (!existing) return fail(res, 404, 'Not found');
    const own = String(existing.sellerId) === String(req.user._id);
    if (!own && !isManager(req.user) && !['active', 'sold'].includes(existing.status)) return fail(res, 404, 'This listing is no longer available');

    const listing = await MarketplaceListing.findByIdAndUpdate(existing._id, own ? {} : { $inc: { views: 1 } }, { new: true })
      .populate('sellerId', SELLER);
    const [data] = await withRatings(req.estateId, [listing]);
    const [reviews, myReport, myReview, sellerSold] = await Promise.all([
      MarketplaceReview.find({ sellerId: listing.sellerId._id }).sort({ createdAt: -1 }).limit(5).populate('reviewerId', 'name profilePhoto').lean(),
      MarketplaceReport.exists({ listingId: listing._id, reporterId: req.user._id }),
      MarketplaceReview.findOne({ listingId: listing._id, reviewerId: req.user._id }).lean(),
      MarketplaceListing.countDocuments({ estateId: req.estateId, sellerId: listing.sellerId._id, status: 'sold' }),
    ]);
    if (!own && !isManager(req.user)) { delete data.flags; delete data.reportCount; }
    return res.json({ success: true, data: { ...data, reviews, sellerSold, reported: !!myReport, myReview } });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// Atomic save toggle.
exports.toggleSave = async (req, res) => {
  try {
    const uid = req.user._id;
    const filter = { _id: req.params.id, estateId: req.estateId };
    let saved = true;
    let doc = await MarketplaceListing.findOneAndUpdate({ ...filter, savedBy: { $ne: uid } }, { $addToSet: { savedBy: uid } }, { new: true });
    if (!doc) { doc = await MarketplaceListing.findOneAndUpdate({ ...filter, savedBy: uid }, { $pull: { savedBy: uid } }, { new: true }); saved = false; }
    if (!doc) return fail(res, 404, 'Not found');
    return res.json({ success: true, saved, data: doc });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// POST /:id/report — one report per resident per listing. Enough distinct
// reports pull the listing from the market until management reviews it.
exports.reportListing = async (req, res) => {
  try {
    const { reason, note = '' } = req.body;
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return fail(res, 404, 'Not found');
    if (String(listing.sellerId) === String(req.user._id)) return fail(res, 400, 'You can\'t report your own listing');

    try {
      await MarketplaceReport.create({ estateId: req.estateId, listingId: listing._id, sellerId: listing.sellerId, reporterId: req.user._id, reason, note: String(note).slice(0, 500) });
    } catch (e) {
      if (e.code === 11000) return fail(res, 409, 'You already reported this listing. Estate management is on it.');
      throw e;
    }

    const open = await MarketplaceReport.countDocuments({ listingId: listing._id, status: 'open' });
    listing.reportCount = open;
    const settings = await MarketplaceSettings.forEstate(req.estateId);
    let hidden = false;
    if (open >= settings.autoHideReports && listing.status === 'active') {
      listing.status = 'pending_approval';
      listing.flags.push({ type: 'reported', detail: `${open} residents reported this listing` });
      hidden = true;
    }
    await listing.save();

    notifyManagers(req.estateId, {
      id: `mkt-report-${listing._id}-${req.user._id}`, type: 'marketplace_report',
      title: hidden ? 'Listing hidden after reports' : 'Marketplace listing reported',
      body: `"${listing.title}" — ${reason.replace(/_/g, ' ')}${note ? `: ${String(note).slice(0, 80)}` : ''}`,
      meta: { listingId: String(listing._id) },
    });
    return res.status(201).json({ success: true, message: 'Thanks. Estate management will look into it.' });
  } catch (err) {
    console.error('[marketplace report]', err.message);
    return fail(res, 500, 'Server error');
  }
};

// POST /:id/review — rate the seller (1–5). Re-posting updates your review.
exports.reviewSeller = async (req, res) => {
  try {
    const rating = parseInt(req.body.rating);
    if (!(rating >= 1 && rating <= 5)) return fail(res, 400, 'Rating must be 1–5 stars');
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId }).select('sellerId title estateId');
    if (!listing) return fail(res, 404, 'Not found');
    if (String(listing.sellerId) === String(req.user._id)) return fail(res, 400, 'You can\'t rate yourself');

    const review = await MarketplaceReview.findOneAndUpdate(
      { listingId: listing._id, reviewerId: req.user._id },
      { estateId: req.estateId, sellerId: listing.sellerId, rating, comment: String(req.body.comment || '').slice(0, 400) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    notifySeller(listing, `${req.user.name.split(' ')[0]} rated you ${'★'.repeat(rating)}`, `For "${listing.title}"`);
    const rating_ = (await ratingsFor(req.estateId, [listing.sellerId]))[String(listing.sellerId)];
    return res.json({ success: true, data: review, sellerRating: rating_ });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// ─────────────────────────── Estate management ───────────────────────────

exports.adminStats = async (req, res) => {
  try {
    const e = req.estateId;
    const [byStatus, openReports, sellers, gmv] = await Promise.all([
      MarketplaceListing.aggregate([{ $match: { estateId: new mongoose.Types.ObjectId(String(e)) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      MarketplaceReport.countDocuments({ estateId: e, status: 'open' }),
      MarketplaceListing.distinct('sellerId', { estateId: e, status: { $in: ['active', 'pending_approval'] } }),
      MarketplaceListing.aggregate([{ $match: { estateId: new mongoose.Types.ObjectId(String(e)), status: 'sold' } }, { $group: { _id: null, v: { $sum: '$price' } } }]),
    ]);
    const s = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    return res.json({ success: true, data: {
      active: s.active || 0, pending: s.pending_approval || 0, sold: s.sold || 0,
      rejected: s.rejected || 0, removed: s.removed || 0,
      openReports, activeSellers: sellers.length, soldValue: gmv[0]?.v || 0,
    } });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.adminListings = async (req, res) => {
  try {
    const { status, q, category, sellerId } = req.query;
    const filter = { estateId: req.estateId };
    if (sellerId && mongoose.isValidObjectId(sellerId)) filter.sellerId = sellerId;
    if (status && status !== 'all') filter.status = status;
    if (category) filter.category = category;
    if (q?.trim()) { const re = new RegExp(escapeRe(q.trim()), 'i'); filter.$or = [{ title: re }, { description: re }]; }
    const listings = await MarketplaceListing.find(filter)
      .populate('sellerId', SELLER).populate('moderation.by', 'name')
      .sort(status === 'pending_approval' ? { updatedAt: 1 } : { createdAt: -1 }).limit(200);
    // Typical price per category so managers can judge outliers at a glance.
    const medians = {};
    for (const c of [...new Set(listings.map((l) => l.category))]) medians[c] = await categoryMedian(req.estateId, c);
    return res.json({ success: true, data: await withRatings(req.estateId, listings), medians });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

async function moderate(req, res, { to, from, needReason, title, body }) {
  const reason = String(req.body.reason || '').trim();
  if (needReason && !reason) return fail(res, 400, 'Give the seller a reason');
  const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
  if (!listing) return fail(res, 404, 'Not found');
  if (from && !from.includes(listing.status)) return fail(res, 409, `Listing is ${listing.status.replace(/_/g, ' ')}`);
  listing.status = to;
  listing.moderation = { reason, by: req.user._id, at: new Date() };
  if (to === 'active') listing.flags = [];
  await listing.save();
  notifySeller(listing, title(listing), body(listing, reason));
  await listing.populate('sellerId', SELLER);
  return res.json({ success: true, data: listing });
}

exports.approve = (req, res) => moderate(req, res, {
  to: 'active', from: ['pending_approval', 'rejected'],
  title: () => 'Your listing is live ✅', body: (l) => `"${l.title}" was approved by estate management.`,
}).catch(() => fail(res, 500, 'Server error'));

exports.reject = (req, res) => moderate(req, res, {
  to: 'rejected', from: ['pending_approval', 'active'], needReason: true,
  title: () => 'Listing not approved', body: (l, r) => `"${l.title}": ${r}. Edit it and resubmit.`,
}).catch(() => fail(res, 500, 'Server error'));

exports.remove = (req, res) => moderate(req, res, {
  to: 'removed', needReason: true,
  title: () => 'Listing removed by estate management', body: (l, r) => `"${l.title}": ${r}`,
}).catch(() => fail(res, 500, 'Server error'));

exports.restore = (req, res) => moderate(req, res, {
  to: 'active', from: ['removed', 'rejected'],
  title: () => 'Your listing was restored', body: (l) => `"${l.title}" is live again.`,
}).catch(() => fail(res, 500, 'Server error'));

exports.adminReports = async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const reports = await MarketplaceReport.find({ estateId: req.estateId, ...(status === 'all' ? {} : { status }) })
      .populate('listingId', 'title price images status category')
      .populate('sellerId', 'name profilePhoto phone')
      .populate('reporterId', 'name profilePhoto')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 }).limit(200);
    return res.json({ success: true, data: reports });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// POST /admin/reports/:id/resolve { action: 'dismiss'|'uphold', resolution, removeListing? }
// Resolving one report settles every open report on the same listing.
exports.resolveReport = async (req, res) => {
  try {
    const { action, resolution = '', removeListing } = req.body;
    if (!['dismiss', 'uphold'].includes(action)) return fail(res, 400, 'action must be dismiss or uphold');
    const report = await MarketplaceReport.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!report) return fail(res, 404, 'Not found');

    const status = action === 'uphold' ? 'upheld' : 'dismissed';
    const upd = await MarketplaceReport.updateMany(
      { listingId: report.listingId, status: 'open' },
      { status, resolution: String(resolution).slice(0, 300), resolvedBy: req.user._id, resolvedAt: new Date() },
    );

    const listing = await MarketplaceListing.findById(report.listingId);
    if (listing) {
      listing.reportCount = 0;
      if (action === 'uphold' && removeListing) {
        listing.status = 'removed';
        listing.moderation = { reason: resolution || 'Removed after resident reports', by: req.user._id, at: new Date() };
        notifySeller(listing, 'Listing removed by estate management', `"${listing.title}": ${listing.moderation.reason}`);
      } else if (action === 'dismiss' && listing.status === 'pending_approval' && listing.flags.every((f) => f.type === 'reported')) {
        listing.status = 'active'; // hidden only because of reports — put it back
        listing.flags = [];
      }
      await listing.save();
    }
    return res.json({ success: true, resolved: upd.modifiedCount, listingStatus: listing?.status });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.adminSellers = async (req, res) => {
  try {
    const eid = new mongoose.Types.ObjectId(String(req.estateId));
    const [rows, reports, settings] = await Promise.all([
      MarketplaceListing.aggregate([
        { $match: { estateId: eid } },
        { $group: {
          _id: '$sellerId',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          sold: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
          removed: { $sum: { $cond: [{ $in: ['$status', ['removed', 'rejected']] }, 1, 0] } },
          lastListed: { $max: '$createdAt' },
        } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, profilePhoto: 1, phone: 1, unitNumber: 1 } }] } },
        { $sort: { lastListed: -1 } },
      ]),
      MarketplaceReport.aggregate([{ $match: { estateId: eid } }, { $group: { _id: '$sellerId', all: { $sum: 1 }, upheld: { $sum: { $cond: [{ $eq: ['$status', 'upheld'] }, 1, 0] } }, open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } } } }]),
      MarketplaceSettings.forEstate(req.estateId),
    ]);
    const rep = Object.fromEntries(reports.map((r) => [String(r._id), r]));
    const ratings = await ratingsFor(req.estateId, rows.map((r) => r._id));
    const data = rows.map((r) => {
      const id = String(r._id);
      const sus = activeSuspension(settings, id);
      return {
        _id: id, user: r.u[0] || { name: 'Former resident' },
        total: r.total, active: r.active, sold: r.sold, removed: r.removed, lastListed: r.lastListed,
        reports: rep[id] || { all: 0, upheld: 0, open: 0 },
        rating: ratings[id] || { avg: 0, count: 0 },
        suspended: sus ? { reason: sus.reason, until: sus.until } : null,
      };
    });
    return res.json({ success: true, data });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// POST /admin/sellers/:id/suspend { reason, days? } — hides their live listings too.
exports.suspendSeller = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return fail(res, 400, 'Give a reason');
    const days = parseInt(req.body.days) || 0;
    const settings = await MarketplaceSettings.forEstate(req.estateId);
    settings.suspendedSellers = settings.suspendedSellers.filter((s) => String(s.userId) !== String(req.params.id));
    settings.suspendedSellers.push({ userId: req.params.id, reason, until: days ? new Date(Date.now() + days * 86400_000) : undefined, by: req.user._id });
    await settings.save();
    const hidden = await MarketplaceListing.updateMany(
      { estateId: req.estateId, sellerId: req.params.id, status: { $in: ['active', 'pending_approval'] } },
      { status: 'removed', moderation: { reason: `Seller suspended: ${reason}`, by: req.user._id, at: new Date() } },
    );
    emitNotification(req.estateId, {
      id: `mkt-suspend-${req.params.id}-${Date.now()}`, type: 'marketplace',
      title: 'Marketplace access suspended', body: `${reason}${days ? ` (for ${days} day${days === 1 ? '' : 's'})` : ''}`,
    }, req.params.id);
    return res.json({ success: true, hidden: hidden.modifiedCount });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.unsuspendSeller = async (req, res) => {
  try {
    const settings = await MarketplaceSettings.forEstate(req.estateId);
    settings.suspendedSellers = settings.suspendedSellers.filter((s) => String(s.userId) !== String(req.params.id));
    await settings.save();
    emitNotification(req.estateId, {
      id: `mkt-unsuspend-${req.params.id}-${Date.now()}`, type: 'marketplace',
      title: 'Marketplace access restored', body: 'You can list items again.',
    }, req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.getSettings = async (req, res) => {
  try {
    const s = await MarketplaceSettings.forEstate(req.estateId);
    // Category medians help managers pick sensible caps.
    const medians = {};
    for (const c of MarketplaceSettings.CATEGORIES) medians[c] = await categoryMedian(req.estateId, c);
    return res.json({ success: true, data: s, medians });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const s = await MarketplaceSettings.forEstate(req.estateId);
    const b = req.body || {};
    if (b.requireApproval !== undefined) s.requireApproval = !!b.requireApproval;
    if (b.priceCaps) {
      for (const c of MarketplaceSettings.CATEGORIES) {
        if (c in b.priceCaps) {
          const v = b.priceCaps[c];
          s.priceCaps[c] = v === null || v === '' || Number(v) <= 0 ? null : Number(v);
        }
      }
    }
    if (b.outlierMultiplier !== undefined) s.outlierMultiplier = Math.max(0, Number(b.outlierMultiplier) || 0);
    if (b.maxActivePerSeller !== undefined) s.maxActivePerSeller = Math.max(1, parseInt(b.maxActivePerSeller) || 1);
    if (b.autoHideReports !== undefined) s.autoHideReports = Math.max(1, parseInt(b.autoHideReports) || 1);
    if (Array.isArray(b.bannedWords)) s.bannedWords = [...new Set(b.bannedWords.map((w) => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 200);
    await s.save();
    return res.json({ success: true, data: s });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};
