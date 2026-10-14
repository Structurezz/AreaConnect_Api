const mongoose = require('mongoose');
const User = require('../models/User');
const Estate = require('../models/Estate');
const CreditGrant = require('../models/CreditGrant');
const { addCredits } = require('../utils/credits');
const { emitNotification } = require('../services/socketService');
const CreditTransaction = require('../models/CreditTransaction');
const { emailCreditReceiptsInBackground } = require('../services/creditReceiptService');

// AreaConnect admins giving bonus call credits ("airtime") — to any users on
// the platform, or to every resident of one or more estates.

const MAX_PER_USER = 10_000;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /admin/credits/users?q= — search anyone on the platform
exports.searchUsers = async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = { isActive: true, role: { $ne: 'super_admin' } };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const estates = await Estate.find({ $or: [{ name: rx }, { estateCode: rx }] }).select('_id').lean();
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { estateId: { $in: estates.map((e) => e._id) } }];
  }
  const users = await User.find(filter).select('name email role profilePhoto estateId callCredits')
    .populate('estateId', 'name').sort({ name: 1 }).limit(50).lean();
  res.json({ success: true, data: users.map((u) => ({ ...u, estate: u.estateId?.name || '', estateId: u.estateId?._id })) });
};

// GET /admin/credits/estates — estates with their active resident counts
exports.listEstates = async (req, res) => {
  const [estates, counts] = await Promise.all([
    Estate.find({}).select('name estateCode isActive').sort({ name: 1 }).lean(),
    User.aggregate([
      { $match: { role: 'resident', isActive: true, estateId: { $ne: null } } },
      { $group: { _id: '$estateId', residents: { $sum: 1 } } },
    ]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.residents]));
  res.json({ success: true, data: estates.map((e) => ({ ...e, residents: byId.get(String(e._id)) || 0 })) });
};

// GET /admin/credits/grants — recent grants
exports.listGrants = async (req, res) => {
  const grants = await CreditGrant.find({}).sort({ createdAt: -1 }).limit(50)
    .populate('adminId', 'name').populate('estateIds', 'name').lean();
  res.json({ success: true, data: grants });
};

/**
 * POST /admin/credits/grant
 * body: { credits, note?, userIds?: [], estateIds?: [], requestId }
 * Exactly one of userIds / estateIds. `requestId` (client-generated) makes the
 * grant safe to retry: each user's credit is keyed on requestId+userId, so a
 * double click or network retry can never pay anyone twice.
 */
exports.grant = async (req, res) => {
  try {
    const credits = Math.floor(Number(req.body.credits));
    const note = String(req.body.note || '').trim().slice(0, 200);
    const requestId = String(req.body.requestId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const userIds = (req.body.userIds || []).filter((id) => mongoose.isValidObjectId(id));
    const estateIds = (req.body.estateIds || []).filter((id) => mongoose.isValidObjectId(id));

    if (!(credits >= 1 && credits <= MAX_PER_USER)) return res.status(400).json({ success: false, message: `Credits must be between 1 and ${MAX_PER_USER}` });
    if (!requestId) return res.status(400).json({ success: false, message: 'Missing requestId' });
    if (!!userIds.length === !!estateIds.length) return res.status(400).json({ success: false, message: 'Choose people or estates' });

    const recipients = userIds.length
      ? await User.find({ _id: { $in: userIds }, isActive: true }).select('_id estateId').lean()
      : await User.find({ estateId: { $in: estateIds }, role: 'resident', isActive: true }).select('_id estateId').lean();
    if (!recipients.length) return res.status(400).json({ success: false, message: 'No active users to credit' });

    // One audit record per grant, even across retries of the same request.
    const grant = await CreditGrant.findOneAndUpdate(
      { requestId },
      { $setOnInsert: { requestId, adminId: req.user._id, scope: userIds.length ? 'users' : 'estates', estateIds, creditsEach: credits, note } },
      { upsert: true, new: true }
    );

    const description = note ? `Bonus from AreaConnect — ${note}` : 'Bonus from AreaConnect';
    let credited = 0;
    let failed = 0;
    const creditedRefs = [];
    // Batches keep the DB busy but bounded on big estates.
    for (let i = 0; i < recipients.length; i += 50) {
      const batch = recipients.slice(i, i + 50);
      const results = await Promise.allSettled(batch.map((u) => addCredits(u._id, credits, {
        type: 'grant', description, estateId: u.estateId || undefined,
        reference: `GRANT-${requestId}-${u._id}`,
      })));
      results.forEach((r, j) => {
        if (r.status === 'rejected') { failed++; return; }
        if (!r.value.added) return; // already granted by an earlier attempt
        credited++;
        creditedRefs.push(`GRANT-${requestId}-${batch[j]._id}`);
        emitNotification(null, {
          id: `grant-${grant._id}-${batch[j]._id}`, type: 'credits_added',
          title: `🎁 ${credits} bonus call credits`,
          body: `${note || 'A gift from AreaConnect'} — balance ${r.value.balance}`,
          meta: { balance: r.value.balance, grantId: String(grant._id) },
        }, batch[j]._id);
      });
    }

    // Gift receipt emails (with PDF) to everyone credited this time, paced in
    // the background so a big estate grant returns immediately.
    if (creditedRefs.length) {
      CreditTransaction.find({ reference: { $in: creditedRefs } }).select('_id').lean()
        .then((rows) => emailCreditReceiptsInBackground(rows.map((x) => x._id)))
        .catch((e) => console.error('[grant receipts]', e.message));
    }

    // Retries add whoever the earlier attempt missed.
    await CreditGrant.updateOne({ _id: grant._id }, {
      $inc: { recipients: credited, totalCredits: credited * grant.creditsEach },
      $set: { status: failed ? 'partial' : 'done' },
    });
    grant.totalCredits = (grant.totalCredits || 0) + credited * grant.creditsEach;

    res.status(201).json({
      success: true,
      message: `Gave ${credits} credits to ${credited} ${credited === 1 ? 'person' : 'people'}${failed ? ` (${failed} failed — retry to finish)` : ''}`,
      data: { grantId: grant._id, credited, failed, alreadyGranted: recipients.length - credited - failed, totalCredits: credited * grant.creditsEach },
    });
  } catch (e) {
    console.error('[credits.grant]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
