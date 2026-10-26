const mongoose = require('mongoose');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Visitor = require('../models/Visitor');
const SecurityLog = require('../models/SecurityLog');
const SafetyIncident = require('../models/SafetyIncident');
const Subscription = require('../models/Subscription');
require('../models/Plan');
const Announcement = require('../models/Announcement');
const { emitAlert, emitAnnouncement } = require('../services/socketService');

const MIN = 60000;
const byId = (rows, key = '_id') => Object.fromEntries(rows.map((r) => [String(r[key]), r]));
const round = (n) => (n == null ? null : Math.round(n));

// Security score out of 100 + the gaps that cost points (used as recommendations)
function scoreEstate(e) {
  const gaps = [];
  let score = 0;
  const add = (pts, ok, gap) => { if (ok) score += pts; else if (gap) gaps.push({ ...gap, points: pts }); };

  add(20, e.guards.total > 0, { key: 'no_guards', severity: 'high', title: 'No guards on the app', action: 'Invite the gate team to the Guard app so visitors are verified at the gate.' });
  add(15, e.guards.active24h > 0, e.guards.total > 0 && { key: 'guards_idle', severity: 'high', title: 'Guards haven’t signed in for 24h', action: 'Ask the manager to check the gate phone is charged and logged in each shift.' });
  add(10, e.visitors.week > 0, { key: 'no_visitor_logs', severity: 'medium', title: 'No visitors logged this week', action: 'Encourage residents to send visitor passes so every entry is recorded.' });
  add(10, !!e.settings.requireVisitorApproval, { key: 'approval_off', severity: 'medium', title: 'Visitor approval is off', action: 'Turn on “visitors need resident approval” so guards confirm with the host first.' });
  const ack = e.alerts.avgAckMins;
  add(15, ack == null || ack <= 5, ack != null && { key: 'slow_response', severity: ack > 15 ? 'high' : 'medium', title: `Alerts take ${ack} min to acknowledge`, action: 'Set a 5-minute response target with the guards; the manager can be added as backup.' });
  add(10, e.alerts.open === 0, { key: 'open_alerts', severity: 'high', title: `${e.alerts.open} alert${e.alerts.open === 1 ? '' : 's'} still open`, action: 'Acknowledge and resolve open alerts — residents see the status.' });
  add(5, !!e.hasManager, { key: 'no_manager', severity: 'medium', title: 'No estate manager', action: 'Assign a manager so alerts always reach a decision-maker.' });
  add(5, !!e.hasPin, { key: 'no_pin', severity: 'low', title: 'Gate not on the map', action: 'Set the map pin so responders and visitors find the right gate.' });
  add(10, !!e.plan.securityPortal, { key: 'no_security_plan', severity: 'low', title: 'Plan without the security portal', action: 'Offer an upgrade (or comp) to a plan with the security portal and emergency broadcast.' });
  return { score: Math.max(0, Math.min(100, score)), gaps: gaps.sort((a, b) => b.points - a.points) };
}

// GET /api/admin/security/overview?days=30
exports.overview = async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const now = new Date();
    const since = new Date(now - days * 86400000);
    const dayAgo = new Date(now - 86400000);
    const weekAgo = new Date(now - 7 * 86400000);
    const fifteen = new Date(now - 15 * MIN);
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    const [estates, guards, residents, alertAgg, alertTypes, alertDaily, alertHourly, openAlerts, recentAlerts,
      visitorsAgg, insideNow, denied, incidents, subs] = await Promise.all([
      Estate.find({ isActive: { $ne: false } }).select('name estateCode address city state settings location managerId createdAt').populate('managerId', 'name email phone').lean(),
      User.aggregate([{ $match: { role: 'security' } }, { $group: {
        _id: '$estateId', total: { $sum: 1 },
        activeNow: { $sum: { $cond: [{ $gte: ['$lastSeen', fifteen] }, 1, 0] } },
        active24h: { $sum: { $cond: [{ $gte: ['$lastSeen', dayAgo] }, 1, 0] } },
      } }]),
      User.aggregate([{ $match: { role: 'resident', isActive: true } }, { $group: { _id: '$estateId', n: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: {
        _id: '$estateId', total: { $sum: 1 },
        critical: { $sum: { $cond: [{ $in: ['$severity', ['high', 'critical']] }, 1, 0] } },
        broadcasts: { $sum: { $cond: ['$isEmergencyBroadcast', 1, 0] } },
        ackMins: { $avg: { $cond: [{ $ifNull: ['$acknowledgedAt', false] }, { $divide: [{ $subtract: ['$acknowledgedAt', '$createdAt'] }, MIN] }, null] } },
        resolveMins: { $avg: { $cond: [{ $ifNull: ['$resolvedAt', false] }, { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, MIN] }, null] } },
        resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
      } }]),
      Alert.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { createdAt: { $gte: new Date(now - 14 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } }, n: { $sum: 1 }, critical: { $sum: { $cond: [{ $in: ['$severity', ['high', 'critical']] }, 1, 0] } } } }]),
      Alert.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $hour: { date: '$createdAt', timezone: 'Africa/Lagos' } }, n: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { status: { $in: ['open', 'acknowledged'] } } }, { $group: { _id: '$estateId', open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } }, acknowledged: { $sum: { $cond: [{ $eq: ['$status', 'acknowledged'] }, 1, 0] } } } }]),
      Alert.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(25)
        .populate('estateId', 'name').populate('residentId', 'name').populate('resolvedBy', 'name').lean(),
      Visitor.aggregate([{ $match: { createdAt: { $gte: weekAgo } } }, { $group: {
        _id: '$estateId', week: { $sum: 1 }, today: { $sum: { $cond: [{ $gte: ['$createdAt', today] }, 1, 0] } },
      } }]),
      Visitor.aggregate([{ $match: { status: 'checked-in' } }, { $group: { _id: '$estateId', n: { $sum: 1 } } }]),
      SecurityLog.aggregate([{ $match: { action: 'access_denied', createdAt: { $gte: since } } }, { $group: { _id: '$estateId', n: { $sum: 1 } } }]),
      SafetyIncident.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { estate: '$estateId', type: '$type' }, n: { $sum: 1 } } }]),
      Subscription.find().select('estateId planId comp status').populate('planId', 'name features').populate('comp.planId', 'name features').lean(),
    ]);

    const G = byId(guards), R = byId(residents), A = byId(alertAgg), O = byId(openAlerts), V = byId(visitorsAgg), IN = byId(insideNow), D = byId(denied);
    const subBy = Object.fromEntries(subs.map((s) => [String(s.estateId), s]));
    const incBy = {};
    incidents.forEach((i) => { const k = String(i._id.estate); (incBy[k] ||= { total: 0 }); incBy[k].total += i.n; incBy[k][i._id.type] = i.n; });

    const rows = estates.map((e) => {
      const k = String(e._id);
      const s = subBy[k];
      const compLive = !!(s?.comp?.isActive && s.comp.planId && (!s.comp.expiresAt || new Date(s.comp.expiresAt) > now));
      const plan = (compLive ? s.comp.planId : s?.planId) || {};
      const row = {
        _id: e._id, name: e.name, estateCode: e.estateCode, city: e.city, state: e.state, address: e.address,
        manager: e.managerId ? { name: e.managerId.name, email: e.managerId.email, phone: e.managerId.phone } : null,
        hasManager: !!e.managerId, hasPin: !!e.location?.lat, location: e.location?.lat ? { lat: e.location.lat, lng: e.location.lng } : null,
        settings: { requireVisitorApproval: !!e.settings?.requireVisitorApproval },
        plan: { name: plan.name || null, securityPortal: !!plan.features?.securityPortal, emergencyBroadcast: !!plan.features?.emergencyBroadcast },
        residents: R[k]?.n || 0,
        guards: { total: G[k]?.total || 0, activeNow: G[k]?.activeNow || 0, active24h: G[k]?.active24h || 0 },
        visitors: { today: V[k]?.today || 0, week: V[k]?.week || 0, insideNow: IN[k]?.n || 0, denied: D[k]?.n || 0 },
        alerts: {
          total: A[k]?.total || 0, critical: A[k]?.critical || 0, broadcasts: A[k]?.broadcasts || 0, resolved: A[k]?.resolved || 0,
          open: O[k]?.open || 0, acknowledged: O[k]?.acknowledged || 0,
          avgAckMins: round(A[k]?.ackMins), avgResolveMins: round(A[k]?.resolveMins),
        },
        incidents: incBy[k] || { total: 0 },
      };
      const { score, gaps } = scoreEstate(row);
      return { ...row, score, gaps };
    }).sort((a, b) => a.score - b.score);

    const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
    const allAck = alertAgg.filter((a) => a.ackMins != null);
    const allRes = alertAgg.filter((a) => a.resolveMins != null);
    const wavg = (list, f) => { const n = list.reduce((t, a) => t + a.total, 0); return n ? round(list.reduce((t, a) => t + f(a) * a.total, 0) / n) : null; };

    const dailyMap = Object.fromEntries(alertDaily.map((d) => [d._id, d]));
    const daily = Array.from({ length: 14 }, (_, i) => {
      const dt = new Date(now - (13 - i) * 86400000);
      const key = dt.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
      return { date: key, n: dailyMap[key]?.n || 0, critical: dailyMap[key]?.critical || 0 };
    });
    const hourly = Array.from({ length: 24 }, (_, h) => alertHourly.find((x) => x._id === h)?.n || 0);

    // Platform-wide recommendations: count how many estates share each gap
    const gapCounts = {};
    rows.forEach((r) => r.gaps.forEach((g) => { (gapCounts[g.key] ||= { ...g, estates: [] }).estates.push({ _id: r._id, name: r.name }); }));
    const playbook = Object.values(gapCounts).map((g) => ({ key: g.key, title: g.title.replace(/\d+ (min|alert)/, '').trim(), action: g.action, severity: g.severity, points: g.points, estates: g.estates }))
      .sort((a, b) => b.estates.length * b.points - a.estates.length * a.points);

    return res.json({
      success: true,
      data: {
        days,
        totals: {
          estates: rows.length,
          score: rows.length ? round(sum((r) => r.score) / rows.length) : 0,
          guards: sum((r) => r.guards.total), guardsNow: sum((r) => r.guards.activeNow), guards24h: sum((r) => r.guards.active24h),
          estatesWithGuards: rows.filter((r) => r.guards.total > 0).length,
          residents: sum((r) => r.residents),
          visitorsToday: sum((r) => r.visitors.today), visitorsWeek: sum((r) => r.visitors.week), insideNow: sum((r) => r.visitors.insideNow), denied: sum((r) => r.visitors.denied),
          alerts: sum((r) => r.alerts.total), critical: sum((r) => r.alerts.critical), broadcasts: sum((r) => r.alerts.broadcasts),
          open: sum((r) => r.alerts.open), acknowledged: sum((r) => r.alerts.acknowledged), resolved: sum((r) => r.alerts.resolved),
          avgAckMins: wavg(allAck, (a) => a.ackMins), avgResolveMins: wavg(allRes, (a) => a.resolveMins),
          incidents: sum((r) => r.incidents.total),
          approvalOn: rows.filter((r) => r.settings.requireVisitorApproval).length,
          securityPlans: rows.filter((r) => r.plan.securityPortal).length,
        },
        byType: Object.fromEntries(alertTypes.map((t) => [t._id || 'other', t.n])),
        daily, hourly, estates: rows, playbook,
        recent: recentAlerts.map((a) => ({
          _id: a._id, type: a.type, severity: a.severity, status: a.status, title: a.title, note: a.note, location: a.location,
          isEmergencyBroadcast: a.isEmergencyBroadcast, raisedByRole: a.raisedByRole, createdAt: a.createdAt,
          acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt,
          estate: a.estateId ? { _id: a.estateId._id, name: a.estateId.name } : null,
          raisedBy: a.residentId?.name || null, resolvedBy: a.resolvedBy?.name || null,
        })),
      },
    });
  } catch (err) {
    console.error('[admin security overview]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/admin/security/alerts/:id/(acknowledge|resolve) — estate-less admins
const setAlertStatus = (status) => async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Bad id' });
    const update = status === 'resolved'
      ? { status, resolvedAt: new Date(), resolvedBy: req.user._id }
      : { status, acknowledgedAt: new Date() };
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, status: status === 'resolved' ? { $ne: 'resolved' } : 'open' },
      update, { new: true },
    ).populate('residentId', 'name');
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found or already handled' });
    emitAlert(String(alert.estateId), alert);
    return res.json({ success: true, data: alert });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
exports.acknowledge = setAlertStatus('acknowledged');
exports.resolve = setAlertStatus('resolved');

// POST /api/admin/security/notice { title, body, estateIds?: [], pin?: true } — safety notice to residents
exports.notice = async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 4000);
    if (!title || !body) return res.status(400).json({ success: false, message: 'Title and message are required' });
    const q = { isActive: { $ne: false } };
    if (Array.isArray(req.body.estateIds) && req.body.estateIds.length) q._id = { $in: req.body.estateIds.filter((id) => mongoose.isValidObjectId(id)) };
    const estates = await Estate.find(q).select('_id').lean();
    const docs = await Announcement.insertMany(estates.map((e) => ({
      estateId: e._id, authorId: req.user._id, title, body, category: 'urgent', isPinned: !!req.body.pin,
    })));
    docs.forEach((a) => { try { emitAnnouncement(String(a.estateId), a); } catch { /* ignore */ } });
    return res.status(201).json({ success: true, data: { sent: docs.length } });
  } catch (err) {
    console.error('[admin security notice]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
