const Case = require('../models/Case');
const User = require('../models/User');
const { getLawyerArgument, getLawyerRebuttal, getJudgeVerdict, getJudgeAppealRuling, AI_PERSONAS } = require('../services/courtAI');

// ─── helpers ────────────────────────────────────────────────────────────────

function addProceeding(courtCase, { event, actorId, actorName, role, content, isAI }) {
  courtCase.proceedings.push({ event, actorId, actorName, role, content, isAI: !!isAI, timestamp: new Date() });
}

// ─── GET /api/court ──────────────────────────────────────────────────────────

exports.listCases = async (req, res) => {
  try {
    const { status, type, limit = 20, page = 1 } = req.query;
    const estateId = req.user.estateId;

    const filter = { estateId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate('plaintiff.userId', 'name email profilePhoto')
        .populate('defendant.userId', 'name email profilePhoto')
        .sort({ filedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Case.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: cases,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/court/:id ──────────────────────────────────────────────────────

exports.getCase = async (req, res) => {
  try {
    const estateId = req.user.estateId;
    const courtCase = await Case.findOne({ _id: req.params.id, estateId })
      .populate('plaintiff.userId', 'name email profilePhoto')
      .populate('defendant.userId', 'name email profilePhoto')
      .populate('jury.members', 'name email profilePhoto')
      .populate('jury.votes.userId', 'name email')
      .populate('proceedings.actorId', 'name email');

    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court ─────────────────────────────────────────────────────────

exports.fileCase = async (req, res) => {
  try {
    const { title, type, severity, charges, plaintiffStatement, defendantUserId, isDefendantEstate, relatedAction } = req.body;
    const user = req.user;

    if (!title || !type) {
      return res.status(400).json({ success: false, message: 'title and type are required' });
    }

    let defendantName = 'Estate Management';
    let defUserId = null;

    if (!isDefendantEstate && defendantUserId) {
      const defUser = await User.findOne({ _id: defendantUserId, estateId: user.estateId });
      if (!defUser) return res.status(404).json({ success: false, message: 'Defendant user not found in this estate' });
      defendantName = defUser.name;
      defUserId = defUser._id;
    }

    const courtCase = new Case({
      estateId: user.estateId,
      title,
      type,
      severity: severity || 'minor',
      charges: charges || [],
      plaintiffStatement: plaintiffStatement || '',
      plaintiff: { userId: user._id, name: user.name },
      defendant: { userId: defUserId, name: defendantName, isEstate: !!isDefendantEstate },
      relatedAction: relatedAction || undefined,
    });

    addProceeding(courtCase, {
      event: 'case_filed',
      actorId: user._id,
      actorName: user.name,
      role: 'Plaintiff',
      content: `Case "${title}" has been filed by ${user.name}. Charges: ${(charges || []).join(', ') || 'None specified'}.`,
    });

    await courtCase.save();

    return res.status(201).json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/court/:id/open ───────────────────────────────────────────────

exports.openCase = async (req, res) => {
  try {
    const estateId = req.user.estateId;
    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (courtCase.status !== 'filed') {
      return res.status(400).json({ success: false, message: 'Case has already been opened or is past the filing stage' });
    }

    // Pick 5 random active residents (exclude plaintiff and defendant)
    const excludeIds = [courtCase.plaintiff.userId, courtCase.defendant.userId].filter(Boolean);
    const candidates = await User.find({
      estateId,
      role: 'resident',
      isActive: true,
      _id: { $nin: excludeIds },
    }).select('_id name');

    // Fisher-Yates shuffle, take up to 5
    const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 5);
    const juryMembers = shuffled.map(u => u._id);
    const juryNames = shuffled.map(u => u.name).join(', ');

    const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days

    courtCase.status = 'open';
    courtCase.openedAt = new Date();
    courtCase.jury.members = juryMembers;
    courtCase.jury.deadline = deadline;

    addProceeding(courtCase, {
      event: 'case_opened',
      actorId: req.user._id,
      actorName: req.user.name,
      role: 'Estate Manager',
      content: `Case "${courtCase.title}" has been officially opened by the Estate Manager. Court proceedings may now commence.`,
    });

    addProceeding(courtCase, {
      event: 'jury_summoned',
      actorName: 'Court Clerk',
      role: 'Court Clerk',
      content: `The following residents have been summoned to serve as jurors: ${juryNames || 'No eligible residents found'}. Jury deliberation deadline: ${deadline.toDateString()}.`,
    });

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/lawyer ──────────────────────────────────────────────

exports.hireLawyer = async (req, res) => {
  try {
    const { side, persona } = req.body;
    const estateId = req.user.estateId;

    if (!['prosecution','defense'].includes(side)) {
      return res.status(400).json({ success: false, message: 'side must be prosecution or defense' });
    }
    if (!persona || !AI_PERSONAS[persona]) {
      return res.status(400).json({ success: false, message: `persona must be one of: ${Object.keys(AI_PERSONAS).join(', ')}` });
    }

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (!['open','in_hearing'].includes(courtCase.status) && courtCase.status !== 'filed') {
      return res.status(400).json({ success: false, message: 'Cannot hire a lawyer at this stage' });
    }

    // Only plaintiff can hire prosecution; only defendant can hire defense
    const userId = req.user._id.toString();
    if (side === 'prosecution' && courtCase.plaintiff.userId?.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Only the plaintiff can hire prosecution counsel' });
    }
    if (side === 'defense' && courtCase.defendant.userId?.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Only the defendant can hire defense counsel' });
    }

    // Set lawyer
    courtCase.lawyers[side] = { type: 'ai', aiPersona: persona, hiredAt: new Date() };

    const hireEvent = side === 'prosecution' ? 'lawyer_hired_prosecution' : 'lawyer_hired_defense';
    const personaInfo = AI_PERSONAS[persona];

    addProceeding(courtCase, {
      event: hireEvent,
      actorId: req.user._id,
      actorName: req.user.name,
      role: side === 'prosecution' ? 'Plaintiff' : 'Defendant',
      content: `${req.user.name} has retained ${personaInfo.name} as ${side} counsel.`,
    });

    // Generate opening argument from AI lawyer
    const argument = await getLawyerArgument({
      persona,
      caseTitle: courtCase.title,
      caseType: courtCase.type,
      charges: courtCase.charges,
      plaintiffStatement: courtCase.plaintiffStatement,
      evidence: courtCase.evidence,
      side,
    });

    addProceeding(courtCase, {
      event: 'opening_statement',
      actorName: personaInfo.name,
      role: personaInfo.role,
      content: argument,
      isAI: true,
    });

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/argument ────────────────────────────────────────────

exports.submitArgument = async (req, res) => {
  try {
    const { content, side } = req.body;
    const estateId = req.user.estateId;

    if (!content || !side) {
      return res.status(400).json({ success: false, message: 'content and side are required' });
    }
    if (!['prosecution','defense'].includes(side)) {
      return res.status(400).json({ success: false, message: 'side must be prosecution or defense' });
    }

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (!['open','in_hearing'].includes(courtCase.status)) {
      return res.status(400).json({ success: false, message: 'Arguments can only be submitted when the case is open or in hearing' });
    }

    // Determine if this is a first opening_statement or a rebuttal
    const existingStatements = courtCase.proceedings.filter(
      p => p.event === 'opening_statement' && ((side === 'prosecution' && (
        courtCase.plaintiff.userId?.toString() === req.user._id.toString() ||
        p.actorId?.toString() === req.user._id.toString()
      )) || (side === 'defense' && (
        courtCase.defendant.userId?.toString() === req.user._id.toString() ||
        p.actorId?.toString() === req.user._id.toString()
      )))
    );

    const hasOpened = existingStatements.length > 0;
    const event = hasOpened ? 'rebuttal' : 'opening_statement';
    const roleLabel = side === 'prosecution' ? 'Plaintiff / Prosecution' : 'Defendant / Defense';

    addProceeding(courtCase, {
      event,
      actorId: req.user._id,
      actorName: req.user.name,
      role: roleLabel,
      content,
    });

    // If opposing side has an AI lawyer, auto-generate rebuttal
    const opposingSide = side === 'prosecution' ? 'defense' : 'prosecution';
    const opposingLawyer = courtCase.lawyers[opposingSide];

    if (opposingLawyer && opposingLawyer.type === 'ai' && opposingLawyer.aiPersona) {
      const persona = opposingLawyer.aiPersona;
      const personaInfo = AI_PERSONAS[persona];
      const rebuttal = await getLawyerRebuttal({
        persona,
        caseTitle: courtCase.title,
        charges: courtCase.charges,
        evidence: courtCase.evidence,
        opponentArgument: content,
        side: opposingSide,
      });

      addProceeding(courtCase, {
        event: 'rebuttal',
        actorName: personaInfo.name,
        role: personaInfo.role,
        content: rebuttal,
        isAI: true,
      });
    }

    // Advance status to in_hearing if still open
    if (courtCase.status === 'open') {
      courtCase.status = 'in_hearing';
    }

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/evidence ────────────────────────────────────────────

exports.submitEvidence = async (req, res) => {
  try {
    const { label, content, side, mediaUrl } = req.body;
    const estateId = req.user.estateId;

    if (!label || !content || !side) {
      return res.status(400).json({ success: false, message: 'label, content, and side are required' });
    }
    if (!['prosecution','defense','neutral'].includes(side)) {
      return res.status(400).json({ success: false, message: 'side must be prosecution, defense, or neutral' });
    }

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (['closed','settled','verdict_delivered'].includes(courtCase.status)) {
      return res.status(400).json({ success: false, message: 'Cannot submit evidence for a closed or settled case' });
    }

    courtCase.evidence.push({
      submittedById: req.user._id,
      side,
      label,
      content,
      mediaUrl: mediaUrl || undefined,
      submittedAt: new Date(),
    });

    addProceeding(courtCase, {
      event: 'evidence_submitted',
      actorId: req.user._id,
      actorName: req.user.name,
      role: side === 'prosecution' ? 'Prosecution' : side === 'defense' ? 'Defense' : 'Neutral Party',
      content: `Evidence submitted [${side}]: "${label}" — ${content.substring(0, 120)}${content.length > 120 ? '…' : ''}`,
    });

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/jury-vote ───────────────────────────────────────────

exports.castJuryVote = async (req, res) => {
  try {
    const { vote, reasoning } = req.body;
    const estateId = req.user.estateId;
    const userId = req.user._id;

    if (!vote || !['guilty','not_guilty','abstain'].includes(vote)) {
      return res.status(400).json({ success: false, message: 'vote must be guilty, not_guilty, or abstain' });
    }

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    // Verify user is a jury member
    const isMember = courtCase.jury.members.some(m => m.toString() === userId.toString());
    if (!isMember) return res.status(403).json({ success: false, message: 'You are not a juror in this case' });

    // Prevent double-voting
    const alreadyVoted = courtCase.jury.votes.some(v => v.userId.toString() === userId.toString());
    if (alreadyVoted) return res.status(400).json({ success: false, message: 'You have already cast your vote' });

    // Cast vote
    courtCase.jury.votes.push({ userId, vote, reasoning: reasoning || '', castAt: new Date() });

    addProceeding(courtCase, {
      event: 'jury_vote_cast',
      actorId: userId,
      actorName: req.user.name,
      role: 'Juror',
      content: `Juror ${req.user.name} has cast their vote.`,
    });

    // Check if all members have voted or deadline has passed
    const totalMembers = courtCase.jury.members.length;
    const totalVotes = courtCase.jury.votes.length;
    const deadlinePassed = courtCase.jury.deadline && new Date() > courtCase.jury.deadline;

    if (totalVotes >= totalMembers || deadlinePassed) {
      // Tally
      let guilty = 0, notGuilty = 0, abstain = 0;
      courtCase.jury.votes.forEach(v => {
        if (v.vote === 'guilty') guilty++;
        else if (v.vote === 'not_guilty') notGuilty++;
        else abstain++;
      });
      courtCase.jury.tally = { guilty, notGuilty, abstain };

      let juryVerdict = 'none';
      if (guilty > notGuilty) juryVerdict = 'guilty';
      else if (notGuilty > guilty) juryVerdict = 'not_guilty';
      else juryVerdict = 'hung';

      courtCase.jury.verdict = juryVerdict;
      courtCase.status = 'judge_deliberation';

      addProceeding(courtCase, {
        event: 'jury_deliberation_started',
        actorName: 'Court Clerk',
        role: 'Court Clerk',
        content: `Jury deliberation complete. Tally: ${guilty} Guilty / ${notGuilty} Not Guilty / ${abstain} Abstain. Jury recommendation: ${juryVerdict.toUpperCase().replace('_', ' ')}. The matter is now referred to the Judge for final deliberation.`,
      });
    }

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/verdict ─────────────────────────────────────────────

exports.deliverVerdict = async (req, res) => {
  try {
    const estateId = req.user.estateId;
    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    if (['closed','settled','verdict_delivered'].includes(courtCase.status)) {
      return res.status(400).json({ success: false, message: 'Verdict has already been delivered or case is closed' });
    }

    addProceeding(courtCase, {
      event: 'judge_deliberation',
      actorName: 'Judge Orizu',
      role: 'Presiding Judge',
      content: 'The Honourable Judge Orizu is deliberating. All parties are requested to maintain order.',
    });

    const juryTally = courtCase.jury.tally || { guilty: 0, notGuilty: 0, abstain: 0 };
    const verdictResult = await getJudgeVerdict({
      caseTitle: courtCase.title,
      caseType: courtCase.type,
      charges: courtCase.charges,
      severity: courtCase.severity,
      plaintiffStatement: courtCase.plaintiffStatement,
      evidence: courtCase.evidence,
      proceedings: courtCase.proceedings,
      juryVerdict: courtCase.jury.verdict || 'none',
      juryTally,
    });

    const now = new Date();
    courtCase.verdict = {
      decision: verdictResult.decision,
      summary: verdictResult.summary,
      fine: verdictResult.fine || 0,
      punishment: verdictResult.punishment || 'none',
      punishmentDurationDays: verdictResult.punishmentDurationDays || 0,
      deliveredAt: now,
    };
    courtCase.status = 'verdict_delivered';

    addProceeding(courtCase, {
      event: 'verdict_delivered',
      actorName: 'Judge Orizu',
      role: 'Presiding Judge',
      content: verdictResult.summary,
      isAI: true,
    });

    // Handle fine
    if (verdictResult.fine && verdictResult.fine > 0) {
      const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      courtCase.fine = {
        amount: verdictResult.fine,
        status: 'pending',
        dueDate,
      };
      addProceeding(courtCase, {
        event: 'fine_issued',
        actorName: 'Judge Orizu',
        role: 'Presiding Judge',
        content: `A fine of ₦${verdictResult.fine.toLocaleString()} has been issued, due by ${dueDate.toDateString()}.`,
        isAI: true,
      });
    }

    // Enforce related action if verdict is guilty
    if (
      courtCase.relatedAction &&
      ['guilty'].includes(verdictResult.decision) &&
      courtCase.relatedAction.feature
    ) {
      courtCase.relatedAction.isEnforced = true;
    }

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/settle ──────────────────────────────────────────────

exports.proposeSettlement = async (req, res) => {
  try {
    const { terms, amount, action } = req.body;
    const estateId = req.user.estateId;
    const userId = req.user._id;

    if (!['propose','accept','reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be propose, accept, or reject' });
    }

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (['closed','settled','verdict_delivered'].includes(courtCase.status)) {
      return res.status(400).json({ success: false, message: 'Case is not in a settleable state' });
    }

    const isParty = [
      courtCase.plaintiff.userId?.toString(),
      courtCase.defendant.userId?.toString(),
    ].includes(userId.toString());
    if (!isParty) return res.status(403).json({ success: false, message: 'Only case parties can manage settlements' });

    if (action === 'propose') {
      if (!terms) return res.status(400).json({ success: false, message: 'Settlement terms are required' });
      courtCase.settlement = {
        proposedById: userId,
        terms,
        amount: amount || 0,
        status: 'proposed',
        proposedAt: new Date(),
      };
      addProceeding(courtCase, {
        event: 'settlement_proposed',
        actorId: userId,
        actorName: req.user.name,
        role: 'Party',
        content: `Settlement proposed by ${req.user.name}: ${terms}${amount ? ` — Amount: ₦${Number(amount).toLocaleString()}` : ''}`,
      });
    } else if (action === 'accept') {
      if (!courtCase.settlement || courtCase.settlement.status !== 'proposed') {
        return res.status(400).json({ success: false, message: 'No pending settlement proposal to accept' });
      }
      courtCase.settlement.status = 'accepted';
      courtCase.status = 'settled';
      courtCase.closedAt = new Date();
      addProceeding(courtCase, {
        event: 'settlement_accepted',
        actorId: userId,
        actorName: req.user.name,
        role: 'Party',
        content: `Settlement accepted by ${req.user.name}. The case is now settled out of court.`,
      });
    } else if (action === 'reject') {
      if (!courtCase.settlement || courtCase.settlement.status !== 'proposed') {
        return res.status(400).json({ success: false, message: 'No pending settlement proposal to reject' });
      }
      courtCase.settlement.status = 'rejected';
      addProceeding(courtCase, {
        event: 'settlement_rejected',
        actorId: userId,
        actorName: req.user.name,
        role: 'Party',
        content: `Settlement proposal rejected by ${req.user.name}. The case continues.`,
      });
    }

    await courtCase.save();
    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/appeal ──────────────────────────────────────────────

exports.fileAppeal = async (req, res) => {
  try {
    const { reason } = req.body;
    const estateId = req.user.estateId;
    const userId = req.user._id;

    if (!reason) return res.status(400).json({ success: false, message: 'Appeal reason is required' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (courtCase.status !== 'verdict_delivered') {
      return res.status(400).json({ success: false, message: 'Appeals can only be filed after a verdict is delivered' });
    }

    const isParty = [
      courtCase.plaintiff.userId?.toString(),
      courtCase.defendant.userId?.toString(),
    ].includes(userId.toString());
    if (!isParty) return res.status(403).json({ success: false, message: 'Only the plaintiff or defendant can file an appeal' });

    courtCase.appeal = {
      filed: true,
      reason,
      status: 'pending',
      filedAt: new Date(),
    };
    courtCase.status = 'appealing';

    addProceeding(courtCase, {
      event: 'appeal_filed',
      actorId: userId,
      actorName: req.user.name,
      role: 'Appellant',
      content: `Appeal filed by ${req.user.name}. Grounds: ${reason}`,
    });

    await courtCase.save();

    // Get judge ruling on appeal
    const originalDecision = courtCase.verdict?.decision || 'unknown';
    const appealResult = await getJudgeAppealRuling({
      caseTitle: courtCase.title,
      originalVerdict: originalDecision,
      appealReason: reason,
    });

    courtCase.appeal.status = appealResult.granted ? 'granted' : 'denied';
    courtCase.appeal.ruledAt = new Date();
    courtCase.status = appealResult.granted ? 'open' : 'verdict_delivered';

    addProceeding(courtCase, {
      event: 'appeal_ruled',
      actorName: 'Judge Orizu',
      role: 'Presiding Judge',
      content: appealResult.ruling,
      isAI: true,
    });

    if (!appealResult.granted) {
      // Close the case if appeal denied
      courtCase.status = 'closed';
      courtCase.closedAt = new Date();
      addProceeding(courtCase, {
        event: 'case_closed',
        actorName: 'Court Clerk',
        role: 'Court Clerk',
        content: `Appeal denied. The original verdict stands. Case closed.`,
      });
    }

    await courtCase.save();
    return res.json({ success: true, granted: appealResult.granted, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/pay-fine ────────────────────────────────────────────

exports.payFine = async (req, res) => {
  try {
    const estateId = req.user.estateId;
    const userId = req.user._id;

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (!courtCase.fine || courtCase.fine.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending fine on this case' });
    }

    // Only defendant pays the fine
    if (courtCase.defendant.userId?.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only the defendant can pay the fine' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const fineAmount = courtCase.fine.amount;
    if (user.walletBalance < fineAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Fine: ₦${fineAmount.toLocaleString()}, Balance: ₦${user.walletBalance.toLocaleString()}`,
      });
    }

    // Deduct from wallet
    user.walletBalance -= fineAmount;
    await user.save();

    courtCase.fine.status = 'paid';
    courtCase.fine.paidAt = new Date();

    addProceeding(courtCase, {
      event: 'fine_paid',
      actorId: userId,
      actorName: user.name,
      role: 'Defendant',
      content: `Fine of ₦${fineAmount.toLocaleString()} has been paid by ${user.name}.`,
    });

    // Enforce punishment if applicable
    const punishment = courtCase.verdict?.punishment;
    if (punishment && punishment !== 'none') {
      addProceeding(courtCase, {
        event: 'punishment_enforced',
        actorName: 'Court Clerk',
        role: 'Court Clerk',
        content: `Punishment enforced: ${punishment.replace(/_/g, ' ')} for ${courtCase.verdict.punishmentDurationDays} day(s) applied to ${user.name}.`,
      });
    }

    await courtCase.save();
    return res.json({ success: true, data: courtCase, newWalletBalance: user.walletBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/court/stats ────────────────────────────────────────────────────

exports.getPublicStats = async (req, res) => {
  try {
    const estateId = req.user.estateId;

    const [total, byStatus, byType] = await Promise.all([
      Case.countDocuments({ estateId }),
      Case.aggregate([
        { $match: { estateId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Case.aggregate([
        { $match: { estateId } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = {};
    byStatus.forEach(s => { statusCounts[s._id] = s.count; });

    const typeCounts = {};
    byType.forEach(t => { typeCounts[t._id] = t.count; });

    return res.json({
      success: true,
      data: { total, byStatus: statusCounts, byType: typeCounts },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/court/members ───────────────────────────────────────────────────
// Returns all residents in the estate — open to any authenticated estate member

exports.getMembers = async (req, res) => {
  try {
    const estateId = req.user.estateId;
    if (!estateId) return res.status(400).json({ success: false, message: 'No estate assigned' });

    const members = await User.find({ estateId, role: 'resident', isActive: true })
      .select('_id name email unitId')
      .populate('unitId', 'unitNumber block')
      .sort({ name: 1 });

    return res.json({ success: true, data: members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};
