const Case = require('../models/Case');
const User = require('../models/User');
const {
  getLawyerArgument, getLawyerRebuttal, getJudgeVerdict,
  getJudgeAppealRuling, getLawyerConsultation, getAdjournmentRuling, AI_PERSONAS,
} = require('../services/courtAI');

// ─── helpers ────────────────────────────────────────────────────────────────

function addProceeding(courtCase, { event, actorId, actorName, role, content, isAI }) {
  courtCase.proceedings.push({ event, actorId, actorName, role, content, isAI: !!isAI, timestamp: new Date() });
}

function pickProsecutionPersona(caseType) {
  if (['harassment','noise_complaint','property_damage'].includes(caseType)) return 'adaeze';
  if (['community_rules','eviction_dispute','boundary_dispute'].includes(caseType)) return 'ngozi';
  return 'chidi'; // payment_dispute, marketplace_violation, other
}

function pickDefensePersona(prosecutionPersona) {
  return prosecutionPersona === 'chidi' ? 'emeka' : 'emeka'; // emeka is the default defender
}

function hasDefendantEngaged(courtCase) {
  if (!courtCase.defendant?.userId) return true; // estate defendant — no engagement needed
  const defId = courtCase.defendant.userId.toString();
  const hasArg = courtCase.proceedings.some(p =>
    p.actorId && p.actorId.toString() === defId &&
    ['opening_statement','rebuttal','evidence_submitted','closing_argument'].includes(p.event)
  );
  const hasEvid = courtCase.evidence.some(e => e.submittedById?.toString() === defId);
  const hasChat = (courtCase.lawyerChats?.defense || []).some(m => m.from === 'user');
  return hasArg || hasEvid || hasChat;
}

// ─── Auto-advance stale cases (called before returning getCase) ──────────────

async function checkAndAutoAdvance(courtCase) {
  if (['settled','closed','verdict_delivered','appealing'].includes(courtCase.status)) return false;
  const now = new Date();
  let changed = false;

  // Default judgment flow: defendant hasn't responded by deadline
  if (
    courtCase.responseDeadline && now > courtCase.responseDeadline &&
    ['open','in_hearing'].includes(courtCase.status) &&
    !hasDefendantEngaged(courtCase)
  ) {
    if (!courtCase.defaultJudgmentWarningAt) {
      // First warning — extend 24h
      courtCase.defaultJudgmentWarningAt = now;
      courtCase.responseDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      addProceeding(courtCase, {
        event: 'default_judgment_warning',
        actorName: 'Judge Orizu',
        role: 'Presiding Judge',
        content: `ORDER OF THE COURT: The defendant has failed to respond by the court-ordered deadline. The defendant is hereby given a FINAL NOTICE: engage with these proceedings within 24 hours or judgment shall be entered against you by default. Silence is not a defence. — Judge Orizu`,
        isAI: true,
      });
      changed = true;
    } else if (now > courtCase.responseDeadline) {
      // Default judgment
      courtCase.isDefaultJudgment = true;
      courtCase.status = 'verdict_delivered';
      courtCase.closedAt = now;
      const summary = `DEFAULT JUDGMENT — In the matter of "${courtCase.title}", the defendant having failed to respond to court summons and engage with these proceedings, this court finds in favour of the plaintiff by default. The defendant's silence is taken as an admission. Judgment is entered for the plaintiff. The defendant is ordered to pay applicable fines and penalties within 7 days. Failure to comply will result in escalation to the estate management for enforcement action. So ordered. — Judge Orizu`;
      courtCase.verdict = {
        decision: 'guilty',
        summary,
        fine: 5000, // default fine
        punishment: 'warning',
        punishmentDurationDays: 7,
        deliveredAt: now,
      };
      courtCase.fine = { amount: 5000, status: 'pending', dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
      addProceeding(courtCase, {
        event: 'default_judgment',
        actorName: 'Judge Orizu',
        role: 'Presiding Judge',
        content: summary,
        isAI: true,
      });
      changed = true;
    }
  }

  // Auto-advance in_hearing → jury_deliberation when enough arguments exist
  if (courtCase.status === 'in_hearing') {
    const argCount = courtCase.proceedings.filter(p =>
      ['opening_statement','rebuttal'].includes(p.event)
    ).length;
    // After 6+ AI/human arguments, call for closing
    if (argCount >= 6 && !courtCase.proceedings.some(p => p.event === 'closing_arguments_called')) {
      addProceeding(courtCase, {
        event: 'closing_arguments_called',
        actorName: 'Judge Orizu',
        role: 'Presiding Judge',
        content: `ORDER: This court has heard sufficient arguments from both sides. Counsel are hereby directed to prepare closing arguments. After closing arguments, the matter will be referred to the jury for deliberation. — Judge Orizu`,
        isAI: true,
      });
      changed = true;
    }
  }

  return changed;
}

// ─── GET /api/court ──────────────────────────────────────────────────────────

exports.listCases = async (req, res) => {
  try {
    const { status, type, mine, limit = 20, page = 1 } = req.query;
    const estateId = req.user.estateId;
    const filter = { estateId };

    if (mine === 'true' || mine === true) {
      const userId = req.user._id;
      filter.$or = [
        { 'plaintiff.userId': userId },
        { 'defendant.userId': userId },
        { 'jury.members': userId },
      ];
    } else if (status) {
      const statusList = status.split(',').map(s => s.trim()).filter(Boolean);
      filter.status = statusList.length === 1 ? statusList[0] : { $in: statusList };
    }

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

    const changed = await checkAndAutoAdvance(courtCase);
    if (changed) await courtCase.save();

    return res.json({ success: true, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court ─────────────────────────────────────────────────────────
// Filing a case now: auto-opens, auto-assigns AI lawyers, selects jury, generates AI openings

exports.fileCase = async (req, res) => {
  try {
    const { title, type, severity, charges, plaintiffStatement, defendantUserId, isDefendantEstate, relatedAction } = req.body;
    const user = req.user;
    const estateId = user.estateId;

    if (!title || !type) return res.status(400).json({ success: false, message: 'title and type are required' });

    // Resolve defendant
    let defendantName = 'Estate Management', defUserId = null;
    if (!isDefendantEstate && defendantUserId) {
      const defUser = await User.findOne({ _id: defendantUserId, estateId });
      if (!defUser) return res.status(404).json({ success: false, message: 'Defendant user not found' });
      defendantName = defUser.name;
      defUserId = defUser._id;
    }

    // Pick AI lawyers
    const prosecutionPersona = pickProsecutionPersona(type);
    const defensePersona = pickDefensePersona(prosecutionPersona);
    const now = new Date();
    const responseDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days

    // Select 5 random jury members
    const excludeIds = [user._id, defUserId].filter(Boolean);
    const candidates = await User.find({ estateId, role: 'resident', isActive: true, _id: { $nin: excludeIds } })
      .select('_id name').lean();
    const jury = candidates.sort(() => Math.random() - 0.5).slice(0, 5);
    const juryDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const courtCase = new Case({
      estateId,
      title,
      type,
      severity: severity || 'minor',
      charges: charges || [],
      plaintiffStatement: plaintiffStatement || '',
      plaintiff: { userId: user._id, name: user.name },
      defendant: { userId: defUserId, name: defendantName, isEstate: !!isDefendantEstate },
      status: 'open',
      openedAt: now,
      responseDeadline,
      lawyers: {
        prosecution: { type: 'ai', aiPersona: prosecutionPersona, hiredAt: now },
        defense:     { type: 'ai', aiPersona: defensePersona,     hiredAt: now },
      },
      jury: { members: jury.map(j => j._id), deadline: juryDeadline },
      relatedAction: relatedAction || undefined,
    });

    const prosInfo = AI_PERSONAS[prosecutionPersona];
    const defInfo  = AI_PERSONAS[defensePersona];
    const juryNames = jury.map(j => j.name).join(', ') || 'No eligible jurors found';

    addProceeding(courtCase, {
      event: 'case_filed',
      actorId: user._id, actorName: user.name, role: 'Plaintiff',
      content: `Case "${title}" filed. Charges: ${(charges || []).join(', ') || 'None specified'}.`,
    });
    addProceeding(courtCase, {
      event: 'case_opened',
      actorName: 'Court Registrar', role: 'Court Registrar',
      content: `This case has been automatically registered and opened. ${prosInfo.name} (${prosInfo.role}) assigned to Prosecution. ${defInfo.name} (${defInfo.role}) assigned to Defense. The defendant (${defendantName}) has until ${responseDeadline.toDateString()} to engage with proceedings.`,
    });
    addProceeding(courtCase, {
      event: 'jury_summoned',
      actorName: 'Court Clerk', role: 'Court Clerk',
      content: `${jury.length} resident(s) summoned for jury duty: ${juryNames}. Jury deliberation deadline: ${juryDeadline.toDateString()}.`,
    });
    addProceeding(courtCase, {
      event: 'lawyer_hired_prosecution',
      actorId: user._id, actorName: user.name, role: 'Plaintiff',
      content: `${prosInfo.name} engaged as Prosecution Counsel for ${user.name}.`,
    });
    addProceeding(courtCase, {
      event: 'lawyer_hired_defense',
      actorName: 'Court Registrar', role: 'Court Registrar',
      content: `${defInfo.name} assigned as Defense Counsel. ${defendantName} may engage directly through their lawyer at any time.`,
    });

    await courtCase.save();

    // Generate AI opening statements (synchronous — Gemini flash is fast)
    try {
      const [prosArg, defArg] = await Promise.all([
        getLawyerArgument({
          persona: prosecutionPersona, caseTitle: title, caseType: type,
          charges: charges || [], plaintiffStatement: plaintiffStatement || '',
          evidence: [], side: 'prosecution',
        }),
        getLawyerArgument({
          persona: defensePersona, caseTitle: title, caseType: type,
          charges: charges || [], plaintiffStatement: plaintiffStatement || '',
          evidence: [], side: 'defense',
        }),
      ]);

      addProceeding(courtCase, {
        event: 'opening_statement', actorName: prosInfo.name, role: prosInfo.role,
        content: prosArg, isAI: true,
      });
      addProceeding(courtCase, {
        event: 'opening_statement', actorName: defInfo.name, role: defInfo.role,
        content: defArg, isAI: true,
      });
      courtCase.status = 'in_hearing';
      await courtCase.save();
    } catch (aiErr) {
      console.error('AI opening statement error:', aiErr.message);
      // Case is already saved above — AI statements will be missing but that's OK
    }

    // Reload with populated fields
    const populated = await Case.findById(courtCase._id)
      .populate('plaintiff.userId', 'name email')
      .populate('defendant.userId', 'name email');

    return res.status(201).json({ success: true, data: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/court/:id/open (kept for legacy — no-op if already open) ────

exports.openCase = async (req, res) => {
  try {
    const courtCase = await Case.findOne({ _id: req.params.id, estateId: req.user.estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    return res.json({ success: true, data: courtCase, message: 'Cases are now opened automatically on filing.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/chat ─────────────────────────────────────────────────
// Private consultation between a party and their AI lawyer

exports.chatWithLawyer = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'message is required' });

    const estateId = req.user.estateId;
    const userId = req.user._id.toString();

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    // Determine which side the user is on
    const isPlaintiff = courtCase.plaintiff.userId?.toString() === userId;
    const isDefendant = courtCase.defendant.userId?.toString() === userId;
    if (!isPlaintiff && !isDefendant) {
      return res.status(403).json({ success: false, message: 'Only the plaintiff or defendant can consult their lawyer' });
    }

    const side = isPlaintiff ? 'prosecution' : 'defense';
    const persona = courtCase.lawyers[side]?.aiPersona;
    if (!persona) return res.status(400).json({ success: false, message: 'No AI lawyer assigned to your side' });

    // Track defendant engagement
    if (isDefendant && !hasDefendantEngaged(courtCase)) {
      addProceeding(courtCase, {
        event: 'defendant_engaged',
        actorId: req.user._id, actorName: req.user.name, role: 'Defendant',
        content: `${req.user.name} (Defendant) has engaged with the proceedings and is consulting with their legal counsel.`,
      });
    }

    // Store user message
    if (!courtCase.lawyerChats) courtCase.lawyerChats = { prosecution: [], defense: [] };
    if (!courtCase.lawyerChats[side]) courtCase.lawyerChats[side] = [];
    courtCase.lawyerChats[side].push({ from: 'user', content: message.trim(), timestamp: new Date() });
    courtCase.markModified(`lawyerChats.${side}`);

    // Get AI reply
    const reply = await getLawyerConsultation({
      persona, side,
      caseTitle: courtCase.title,
      caseType: courtCase.type,
      charges: courtCase.charges,
      status: courtCase.status,
      evidenceCount: courtCase.evidence.length,
      proceedingCount: courtCase.proceedings.length,
      userMessage: message.trim(),
    });

    courtCase.lawyerChats[side].push({ from: 'ai', content: reply, timestamp: new Date() });
    courtCase.markModified(`lawyerChats.${side}`);

    await courtCase.save();

    return res.json({ success: true, reply, side, persona: AI_PERSONAS[persona].name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/adjourn ──────────────────────────────────────────────

exports.requestAdjournment = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'reason is required' });

    const estateId = req.user.estateId;
    const userId = req.user._id.toString();

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    if (['settled','closed','verdict_delivered'].includes(courtCase.status)) {
      return res.status(400).json({ success: false, message: 'Cannot adjourn a concluded case' });
    }

    const isParty = [
      courtCase.plaintiff.userId?.toString(),
      courtCase.defendant.userId?.toString(),
    ].includes(userId);
    if (!isParty) return res.status(403).json({ success: false, message: 'Only case parties can request adjournment' });

    const isPlaintiff = courtCase.plaintiff.userId?.toString() === userId;
    const side = isPlaintiff ? 'prosecution' : 'defense';
    const adjCount = courtCase.adjournments?.length || 0;

    const { granted, ruling } = await getAdjournmentRuling({
      caseTitle: courtCase.title, reason: reason.trim(), adjournmentCount: adjCount,
    });

    courtCase.adjournments.push({
      requestedById: req.user._id,
      side, reason: reason.trim(), status: granted ? 'granted' : 'denied', aiRuling: ruling,
    });

    if (granted) {
      // Extend response deadline by 3 days
      const base = courtCase.responseDeadline > new Date() ? courtCase.responseDeadline : new Date();
      courtCase.responseDeadline = new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
      // Reset default judgment warning if it was issued
      courtCase.defaultJudgmentWarningAt = undefined;

      addProceeding(courtCase, {
        event: 'adjourned',
        actorName: 'Judge Orizu', role: 'Presiding Judge',
        content: ruling, isAI: true,
      });
    } else {
      addProceeding(courtCase, {
        event: 'adjournment_denied',
        actorName: 'Judge Orizu', role: 'Presiding Judge',
        content: ruling, isAI: true,
      });
    }

    await courtCase.save();
    return res.json({ success: true, granted, ruling, data: courtCase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/court/:id/lawyer ──────────────────────────────────────────────
// Change/upgrade your AI lawyer (optional — already auto-assigned)

exports.hireLawyer = async (req, res) => {
  try {
    const { side, persona } = req.body;
    const estateId = req.user.estateId;

    if (!['prosecution','defense'].includes(side))
      return res.status(400).json({ success: false, message: 'side must be prosecution or defense' });
    if (!persona || !AI_PERSONAS[persona])
      return res.status(400).json({ success: false, message: `persona must be one of: ${Object.keys(AI_PERSONAS).join(', ')}` });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    const userId = req.user._id.toString();
    if (side === 'prosecution' && courtCase.plaintiff.userId?.toString() !== userId)
      return res.status(403).json({ success: false, message: 'Only the plaintiff can change prosecution counsel' });
    if (side === 'defense' && courtCase.defendant.userId?.toString() !== userId)
      return res.status(403).json({ success: false, message: 'Only the defendant can change defense counsel' });

    const prev = courtCase.lawyers[side]?.aiPersona;
    courtCase.lawyers[side] = { type: 'ai', aiPersona: persona, hiredAt: new Date() };

    const info = AI_PERSONAS[persona];
    const hireEvent = side === 'prosecution' ? 'lawyer_hired_prosecution' : 'lawyer_hired_defense';

    addProceeding(courtCase, {
      event: hireEvent,
      actorId: req.user._id, actorName: req.user.name,
      role: side === 'prosecution' ? 'Plaintiff' : 'Defendant',
      content: `${req.user.name} has changed ${side} counsel${prev ? ` from ${AI_PERSONAS[prev]?.name}` : ''} to ${info.name}.`,
    });

    // New counsel delivers a fresh opening statement
    const argument = await getLawyerArgument({
      persona, caseTitle: courtCase.title, caseType: courtCase.type,
      charges: courtCase.charges, plaintiffStatement: courtCase.plaintiffStatement,
      evidence: courtCase.evidence, side,
      context: prev ? `You are replacing ${AI_PERSONAS[prev]?.name} as ${side} counsel. Acknowledge the change and reinforce the case.` : undefined,
    });

    addProceeding(courtCase, {
      event: 'opening_statement', actorName: info.name, role: info.role,
      content: argument, isAI: true,
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

    if (!content || !side) return res.status(400).json({ success: false, message: 'content and side are required' });
    if (!['prosecution','defense'].includes(side)) return res.status(400).json({ success: false, message: 'Invalid side' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (!['open','in_hearing'].includes(courtCase.status))
      return res.status(400).json({ success: false, message: 'Arguments can only be submitted while the case is open or in hearing' });

    // Track defendant engagement
    const isDefendantUser = courtCase.defendant.userId?.toString() === req.user._id.toString();
    if (isDefendantUser) {
      addProceeding(courtCase, {
        event: 'defendant_engaged',
        actorId: req.user._id, actorName: req.user.name, role: 'Defendant',
        content: `${req.user.name} (Defendant) is actively engaged in these proceedings.`,
      });
    }

    const existingArgs = courtCase.proceedings.filter(
      p => (p.event === 'opening_statement' || p.event === 'rebuttal') &&
           p.actorId?.toString() === req.user._id.toString()
    );
    const event = existingArgs.length > 0 ? 'rebuttal' : 'opening_statement';
    const roleLabel = side === 'prosecution' ? 'Plaintiff / Prosecution' : 'Defendant / Defense';

    addProceeding(courtCase, {
      event, actorId: req.user._id, actorName: req.user.name, role: roleLabel, content,
    });

    if (courtCase.status === 'open') courtCase.status = 'in_hearing';

    // Opposing AI lawyer auto-rebuts
    const opposingSide = side === 'prosecution' ? 'defense' : 'prosecution';
    const opposingLawyer = courtCase.lawyers[opposingSide];
    if (opposingLawyer?.type === 'ai' && opposingLawyer?.aiPersona) {
      const rebuttal = await getLawyerRebuttal({
        persona: opposingLawyer.aiPersona,
        caseTitle: courtCase.title,
        charges: courtCase.charges,
        evidence: courtCase.evidence,
        opponentArgument: content,
        side: opposingSide,
      });
      const opInfo = AI_PERSONAS[opposingLawyer.aiPersona];
      addProceeding(courtCase, {
        event: 'rebuttal', actorName: opInfo.name, role: opInfo.role,
        content: rebuttal, isAI: true,
      });
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

    if (!label || !content || !side) return res.status(400).json({ success: false, message: 'label, content, and side required' });
    if (!['prosecution','defense','neutral'].includes(side)) return res.status(400).json({ success: false, message: 'Invalid side' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (['closed','settled','verdict_delivered'].includes(courtCase.status))
      return res.status(400).json({ success: false, message: 'Cannot submit evidence for a concluded case' });

    // Track defendant engagement
    const isDefendantUser = courtCase.defendant.userId?.toString() === req.user._id.toString();
    if (isDefendantUser && !hasDefendantEngaged(courtCase)) {
      addProceeding(courtCase, {
        event: 'defendant_engaged',
        actorId: req.user._id, actorName: req.user.name, role: 'Defendant',
        content: `${req.user.name} (Defendant) has submitted evidence, engaging with these proceedings.`,
      });
    }

    courtCase.evidence.push({
      submittedById: req.user._id, side, label, content, mediaUrl: mediaUrl || undefined, submittedAt: new Date(),
    });

    addProceeding(courtCase, {
      event: 'evidence_submitted',
      actorId: req.user._id, actorName: req.user.name,
      role: side === 'prosecution' ? 'Prosecution' : side === 'defense' ? 'Defense' : 'Neutral',
      content: `Evidence [${side}]: "${label}" — ${content.substring(0, 100)}${content.length > 100 ? '…' : ''}`,
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

    if (!['guilty','not_guilty','abstain'].includes(vote))
      return res.status(400).json({ success: false, message: 'vote must be guilty, not_guilty, or abstain' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });

    const isMember = courtCase.jury.members.some(m => m.toString() === userId.toString());
    if (!isMember) return res.status(403).json({ success: false, message: 'You are not a juror in this case' });

    const alreadyVoted = courtCase.jury.votes.some(v => v.userId.toString() === userId.toString());
    if (alreadyVoted) return res.status(400).json({ success: false, message: 'You have already voted' });

    courtCase.jury.votes.push({ userId, vote, reasoning: reasoning || '', castAt: new Date() });
    addProceeding(courtCase, {
      event: 'jury_vote_cast',
      actorId: userId, actorName: req.user.name, role: 'Juror',
      content: `Juror ${req.user.name} has cast their vote.`,
    });

    const totalMembers = courtCase.jury.members.length;
    const totalVotes   = courtCase.jury.votes.length;
    const deadlinePassed = courtCase.jury.deadline && new Date() > courtCase.jury.deadline;

    if (totalVotes >= totalMembers || deadlinePassed) {
      let guilty = 0, notGuilty = 0, abstain = 0;
      courtCase.jury.votes.forEach(v => {
        if (v.vote === 'guilty') guilty++;
        else if (v.vote === 'not_guilty') notGuilty++;
        else abstain++;
      });
      courtCase.jury.tally    = { guilty, notGuilty, abstain };
      courtCase.jury.verdict  = guilty > notGuilty ? 'guilty' : notGuilty > guilty ? 'not_guilty' : 'hung';
      courtCase.status        = 'judge_deliberation';

      addProceeding(courtCase, {
        event: 'jury_deliberation_started',
        actorName: 'Court Clerk', role: 'Court Clerk',
        content: `Jury deliberation complete. Tally: ${guilty} Guilty / ${notGuilty} Not Guilty / ${abstain} Abstain. Jury recommendation: ${courtCase.jury.verdict.toUpperCase().replace('_',' ')}. The matter is referred to Judge Orizu for final deliberation.`,
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

    if (['closed','settled','verdict_delivered'].includes(courtCase.status))
      return res.status(400).json({ success: false, message: 'Verdict already delivered or case concluded' });

    addProceeding(courtCase, {
      event: 'judge_deliberation',
      actorName: 'Judge Orizu', role: 'Presiding Judge',
      content: 'The Honourable Judge Orizu is deliberating. All parties are requested to maintain order in the court.',
    });

    const juryTally = courtCase.jury.tally || { guilty: 0, notGuilty: 0, abstain: 0 };
    const verdictResult = await getJudgeVerdict({
      caseTitle: courtCase.title, caseType: courtCase.type, charges: courtCase.charges,
      severity: courtCase.severity, plaintiffStatement: courtCase.plaintiffStatement,
      evidence: courtCase.evidence, proceedings: courtCase.proceedings,
      juryVerdict: courtCase.jury.verdict || 'none', juryTally,
    });

    const now = new Date();
    courtCase.verdict = {
      decision: verdictResult.decision, summary: verdictResult.summary,
      fine: verdictResult.fine || 0, punishment: verdictResult.punishment || 'none',
      punishmentDurationDays: verdictResult.punishmentDurationDays || 0, deliveredAt: now,
    };
    courtCase.status = 'verdict_delivered';

    addProceeding(courtCase, {
      event: 'verdict_delivered', actorName: 'Judge Orizu', role: 'Presiding Judge',
      content: verdictResult.summary, isAI: true,
    });

    if (verdictResult.fine > 0) {
      const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      courtCase.fine = { amount: verdictResult.fine, status: 'pending', dueDate };
      addProceeding(courtCase, {
        event: 'fine_issued', actorName: 'Judge Orizu', role: 'Presiding Judge',
        content: `Fine of ₦${verdictResult.fine.toLocaleString()} issued, due by ${dueDate.toDateString()}.`,
        isAI: true,
      });
    }

    if (courtCase.relatedAction?.feature && verdictResult.decision === 'guilty')
      courtCase.relatedAction.isEnforced = true;

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

    if (!['propose','accept','reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be propose, accept, or reject' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (['closed','settled','verdict_delivered'].includes(courtCase.status))
      return res.status(400).json({ success: false, message: 'Case is already concluded' });

    const isParty = [courtCase.plaintiff.userId?.toString(), courtCase.defendant.userId?.toString()].includes(userId.toString());
    if (!isParty) return res.status(403).json({ success: false, message: 'Only case parties can manage settlements' });

    if (action === 'propose') {
      if (!terms) return res.status(400).json({ success: false, message: 'terms required' });
      courtCase.settlement = { proposedById: userId, terms, amount: amount || 0, status: 'proposed', proposedAt: new Date() };
      addProceeding(courtCase, {
        event: 'settlement_proposed', actorId: userId, actorName: req.user.name, role: 'Party',
        content: `Settlement proposed by ${req.user.name}: ${terms}${amount ? ` (₦${Number(amount).toLocaleString()})` : ''}`,
      });
    } else if (action === 'accept') {
      if (!courtCase.settlement || courtCase.settlement.status !== 'proposed')
        return res.status(400).json({ success: false, message: 'No pending settlement to accept' });
      courtCase.settlement.status = 'accepted';
      courtCase.status = 'settled';
      courtCase.closedAt = new Date();
      addProceeding(courtCase, {
        event: 'settlement_accepted', actorId: userId, actorName: req.user.name, role: 'Party',
        content: `Settlement accepted by ${req.user.name}. Case settled out of court.`,
      });
    } else {
      if (!courtCase.settlement || courtCase.settlement.status !== 'proposed')
        return res.status(400).json({ success: false, message: 'No pending settlement to reject' });
      courtCase.settlement.status = 'rejected';
      addProceeding(courtCase, {
        event: 'settlement_rejected', actorId: userId, actorName: req.user.name, role: 'Party',
        content: `Settlement proposal rejected by ${req.user.name}. Case continues.`,
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

    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });

    const courtCase = await Case.findOne({ _id: req.params.id, estateId });
    if (!courtCase) return res.status(404).json({ success: false, message: 'Case not found' });
    if (courtCase.status !== 'verdict_delivered')
      return res.status(400).json({ success: false, message: 'Appeals can only be filed after a verdict' });

    const isParty = [courtCase.plaintiff.userId?.toString(), courtCase.defendant.userId?.toString()].includes(userId.toString());
    if (!isParty) return res.status(403).json({ success: false, message: 'Only case parties can appeal' });

    courtCase.appeal = { filed: true, reason, status: 'pending', filedAt: new Date() };
    courtCase.status = 'appealing';

    addProceeding(courtCase, {
      event: 'appeal_filed', actorId: userId, actorName: req.user.name, role: 'Appellant',
      content: `Appeal filed by ${req.user.name}. Grounds: ${reason}`,
    });

    await courtCase.save();

    const appealResult = await getJudgeAppealRuling({
      caseTitle: courtCase.title,
      originalVerdict: courtCase.verdict?.decision || 'unknown',
      appealReason: reason,
    });

    courtCase.appeal.status = appealResult.granted ? 'granted' : 'denied';
    courtCase.appeal.ruledAt = new Date();
    courtCase.status = appealResult.granted ? 'open' : 'closed';
    if (!appealResult.granted) courtCase.closedAt = new Date();

    addProceeding(courtCase, {
      event: 'appeal_ruled', actorName: 'Judge Orizu', role: 'Presiding Judge',
      content: appealResult.ruling, isAI: true,
    });

    if (!appealResult.granted) {
      addProceeding(courtCase, {
        event: 'case_closed', actorName: 'Court Clerk', role: 'Court Clerk',
        content: 'Appeal denied. Original verdict stands. Case closed.',
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
    if (!courtCase.fine || courtCase.fine.status !== 'pending')
      return res.status(400).json({ success: false, message: 'No pending fine on this case' });
    if (courtCase.defendant.userId?.toString() !== userId.toString())
      return res.status(403).json({ success: false, message: 'Only the defendant pays the fine' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const fineAmount = courtCase.fine.amount;
    if ((user.walletBalance || 0) < fineAmount)
      return res.status(400).json({ success: false, message: `Insufficient wallet balance. Fine: ₦${fineAmount.toLocaleString()}, Balance: ₦${(user.walletBalance||0).toLocaleString()}` });

    user.walletBalance -= fineAmount;
    await user.save();

    courtCase.fine.status = 'paid';
    courtCase.fine.paidAt = new Date();

    addProceeding(courtCase, {
      event: 'fine_paid', actorId: userId, actorName: user.name, role: 'Defendant',
      content: `Fine of ₦${fineAmount.toLocaleString()} paid by ${user.name}.`,
    });

    const punishment = courtCase.verdict?.punishment;
    if (punishment && punishment !== 'none') {
      addProceeding(courtCase, {
        event: 'punishment_enforced', actorName: 'Court Clerk', role: 'Court Clerk',
        content: `Punishment: ${punishment.replace(/_/g,' ')} for ${courtCase.verdict.punishmentDurationDays} day(s) applied to ${user.name}.`,
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
      Case.aggregate([{ $match: { estateId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Case.aggregate([{ $match: { estateId } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ]);
    const statusCounts = {}, typeCounts = {};
    byStatus.forEach(s => { statusCounts[s._id] = s.count; });
    byType.forEach(t => { typeCounts[t._id] = t.count; });
    return res.json({ success: true, data: { total, byStatus: statusCounts, byType: typeCounts } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/court/members ───────────────────────────────────────────────────

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
    res.status(500).json({ success: false, message: err.message });
  }
};
