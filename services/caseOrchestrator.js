// Drives a case through its phases automatically after filing.
// Timers are intentionally spaced so users see things unfold in the live
// feed; if the server restarts, cases pick up again on the next getCase
// via checkAndAutoAdvance.
//
// Phases (per case):
//   T+15s  prosecution rebuttal
//   T+30s  defense rebuttal
//   T+60s  prosecution closing
//   T+75s  defense closing
//   T+95s  jury auto-votes for any juror who hasn't voted
//   T+120s judge verdict
//
// Each step fetches the latest case state and skips if the case has
// advanced via another path (settlement, manual, default judgment).

const Case     = require('../models/Case');
const Estate   = require('../models/Estate');
const User     = require('../models/User');
const {
  getLawyerArgument, getLawyerRebuttal, getJudgeVerdict, AI_PERSONAS,
} = require('./courtAI');
const { getIO } = require('./socketService');

// Internal: emit case update + narrator commentary without circular import.
function emitUpdate(courtCase) {
  const io = getIO();
  if (!io || !courtCase) return;
  const payload = typeof courtCase.toObject === 'function' ? courtCase.toObject() : courtCase;
  io.to(`estate:${courtCase.estateId}`).emit('court:case-updated', payload);
}
function narrate(estateId, caseId, text) {
  const io = getIO();
  if (!io || !text) return;
  io.to(`estate:${estateId}`).emit('court:commentary', { caseId: String(caseId), text, at: Date.now() });
}

async function loadContext(estateId) {
  try {
    const est = await Estate.findById(estateId).select('name constitution.extractedText').lean();
    return {
      constitutionText: est?.constitution?.extractedText || '',
      estateName:       est?.name || '',
    };
  } catch { return { constitutionText: '', estateName: '' }; }
}

const CONCLUDED = new Set(['settled', 'closed', 'verdict_delivered', 'appealing']);

async function doRebuttal(caseId, side) {
  const courtCase = await Case.findById(caseId);
  if (!courtCase || CONCLUDED.has(courtCase.status)) return;
  // Skip if a party already rebutted on this side manually
  const alreadyRebutted = courtCase.proceedings.some(p =>
    p.event === 'rebuttal' && p.role?.toLowerCase().startsWith(side));
  if (alreadyRebutted) return;

  const personaKey = courtCase.lawyers?.[side]?.aiPersona;
  if (!personaKey) return;
  const persona = AI_PERSONAS[personaKey];
  const otherSide = side === 'prosecution' ? 'defense' : 'prosecution';
  const otherLastArg = [...courtCase.proceedings].reverse().find(p =>
    (p.event === 'opening_statement' || p.event === 'rebuttal') &&
    p.role?.toLowerCase().startsWith(otherSide))?.content || '';

  const ctx = await loadContext(courtCase.estateId);
  narrate(courtCase.estateId, courtCase._id,
    side === 'prosecution'
      ? `💬 ${persona.name} rises to rebut the defense.`
      : `💬 ${persona.name} rises to answer the prosecution.`);

  try {
    const rebuttal = await getLawyerRebuttal({
      persona: personaKey, caseTitle: courtCase.title, caseType: courtCase.type,
      charges: courtCase.charges, side,
      opposingArgument: otherLastArg,
      evidence: courtCase.evidence || [],
      ...ctx,
    });
    courtCase.proceedings.push({
      event: 'rebuttal', role: persona.role, actorName: persona.name,
      content: rebuttal, isAI: true, timestamp: new Date(),
    });
    if (courtCase.status === 'open') courtCase.status = 'in_hearing';
    await courtCase.save();
    emitUpdate(courtCase);
  } catch (e) { console.warn('[orch.rebuttal]', side, e.message); }
}

async function doClosing(caseId, side) {
  const courtCase = await Case.findById(caseId);
  if (!courtCase || CONCLUDED.has(courtCase.status)) return;

  const alreadyClosed = courtCase.proceedings.some(p =>
    p.event === 'closing_argument' && p.role?.toLowerCase().startsWith(side));
  if (alreadyClosed) return;

  const personaKey = courtCase.lawyers?.[side]?.aiPersona;
  if (!personaKey) return;
  const persona = AI_PERSONAS[personaKey];
  const ctx = await loadContext(courtCase.estateId);
  narrate(courtCase.estateId, courtCase._id, `🗣️ ${persona.name} begins ${side === 'prosecution' ? 'prosecution' : 'defense'} closing.`);

  try {
    const closing = await getLawyerArgument({
      persona: personaKey, caseTitle: courtCase.title, caseType: courtCase.type,
      charges: courtCase.charges, plaintiffStatement: courtCase.plaintiffStatement,
      evidence: courtCase.evidence || [], side,
      stage: 'closing',
      ...ctx,
    });
    courtCase.proceedings.push({
      event: 'closing_argument', role: persona.role, actorName: persona.name,
      content: closing, isAI: true, timestamp: new Date(),
    });
    await courtCase.save();
    emitUpdate(courtCase);
  } catch (e) { console.warn('[orch.closing]', side, e.message); }
}

async function doJuryAutoVote(caseId) {
  const courtCase = await Case.findById(caseId);
  if (!courtCase || CONCLUDED.has(courtCase.status)) return;

  const members = courtCase.jury?.members || [];
  if (!members.length) return;
  const voted = new Set((courtCase.jury?.votes || []).map(v => v.userId?.toString()));
  const missing = members.filter(m => !voted.has(m.toString()));
  if (!missing.length) return;

  // Simple heuristic: 60% chance of guilty on severity moderate+, else 40%
  const guiltyBias = ['major', 'critical'].includes(courtCase.severity) ? 0.65 : 0.45;
  narrate(courtCase.estateId, courtCase._id, `⚖️ ${missing.length} juror${missing.length !== 1 ? 's' : ''} vote on the case.`);
  for (const uid of missing) {
    const vote = Math.random() < guiltyBias ? 'guilty' : (Math.random() < 0.85 ? 'not_guilty' : 'abstain');
    courtCase.jury.votes.push({
      userId: uid, vote, reasoning: 'Based on the proceedings presented.', votedAt: new Date(),
    });
  }
  // tally
  const t = { guilty: 0, notGuilty: 0, abstain: 0 };
  for (const v of courtCase.jury.votes) {
    if (v.vote === 'guilty') t.guilty++;
    else if (v.vote === 'not_guilty') t.notGuilty++;
    else t.abstain++;
  }
  courtCase.jury.tally = t;
  courtCase.status = 'judge_deliberation';
  courtCase.proceedings.push({
    event: 'jury_verdict', actorName: 'Jury Foreperson', role: 'Jury',
    content: `The jury has voted. Guilty: ${t.guilty}, Not Guilty: ${t.notGuilty}, Abstain: ${t.abstain}. The matter is referred to Judge Orizu.`,
    timestamp: new Date(),
  });
  await courtCase.save();
  emitUpdate(courtCase);
}

async function doVerdict(caseId) {
  const courtCase = await Case.findById(caseId);
  if (!courtCase || CONCLUDED.has(courtCase.status)) return;

  narrate(courtCase.estateId, courtCase._id, `⚖️ Judge Orizu rises to deliver the verdict…`);

  try {
    const ctx = await loadContext(courtCase.estateId);
    const verdict = await getJudgeVerdict({
      caseTitle: courtCase.title, caseType: courtCase.type, severity: courtCase.severity,
      charges: courtCase.charges,
      plaintiffStatement: courtCase.plaintiffStatement,
      proceedings: courtCase.proceedings,
      evidence: courtCase.evidence || [],
      juryTally: courtCase.jury?.tally || { guilty: 0, notGuilty: 0, abstain: 0 },
      ...ctx,
    });

    const now = new Date();
    courtCase.verdict = {
      decision: verdict.decision,
      summary:  verdict.summary,
      fine:     verdict.fine || 0,
      punishment: verdict.punishment || 'none',
      punishmentDurationDays: verdict.punishmentDurationDays || 0,
      deliveredAt: now,
    };
    courtCase.status = 'verdict_delivered';
    courtCase.closedAt = now;
    if ((verdict.fine || 0) > 0) {
      courtCase.fine = {
        amount: verdict.fine, status: 'pending',
        dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      };
    }
    courtCase.proceedings.push({
      event: 'verdict_delivered', actorName: 'Judge Orizu', role: 'Presiding Judge',
      content: verdict.summary, isAI: true, timestamp: now,
    });
    await courtCase.save();
    emitUpdate(courtCase);
    narrate(courtCase.estateId, courtCase._id,
      `🔨 Verdict: ${verdict.decision === 'guilty' ? 'GUILTY' : 'NOT GUILTY'}.`);
  } catch (e) { console.warn('[orch.verdict]', e.message); }
}

function later(fn, ms) { return setTimeout(() => { fn().catch(err => console.warn('[orch]', err.message)); }, ms); }

// Entry: kick off the full auto-run after fileCase. Spaced so the live feed
// has pacing. Each handler is state-safe — if the case already advanced
// manually, the step is a no-op.
exports.autoRunCase = function autoRunCase(caseId) {
  later(() => doRebuttal(caseId, 'prosecution'), 15_000);
  later(() => doRebuttal(caseId, 'defense'),      30_000);
  later(() => doClosing(caseId, 'prosecution'),   60_000);
  later(() => doClosing(caseId, 'defense'),       75_000);
  later(() => doJuryAutoVote(caseId),             95_000);
  later(() => doVerdict(caseId),                 120_000);
};
