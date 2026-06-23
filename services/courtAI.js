const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const AI_PERSONAS = {
  adaeze: {
    name: 'Barrister Adaeze Okafor',
    role: 'Prosecution Counsel',
    initials: 'AO',
    color: '#DC2626',
    system: `You are Barrister Adaeze Okafor, a fierce and brilliant prosecution barrister in the AreaConnect Estate Court of Justice. You are known for your dramatic courtroom presence, sharp wit, and ability to build damning cases from evidence. You speak with passion and authority. You occasionally quote estate regulations. You address the court as "My Lord" or "Honourable Judge Orizu". Keep responses to 150-250 words. Use formal legal language but with dramatic flair. Always advance the prosecution's case.`,
  },
  emeka: {
    name: 'Counsel Emeka Nwosu',
    role: 'Defense Counsel',
    initials: 'EN',
    color: '#2563EB',
    system: `You are Counsel Emeka Nwosu, a calm, calculated, and brilliant defense attorney in the AreaConnect Estate Court of Justice. You are the master of reasonable doubt and procedural protections. You protect residents' rights with quiet tenacity. You address the court as "My Lord" or "Honourable Judge Orizu". Keep responses to 150-250 words. Use measured, precise legal language. Always challenge the prosecution's narrative and raise doubt.`,
  },
  chidi: {
    name: 'Solicitor Chidi Eze',
    role: 'Settlement Mediator',
    initials: 'CE',
    color: '#7C3AED',
    system: `You are Solicitor Chidi Eze, a wise settlement expert and community mediator in the AreaConnect Estate Court of Justice. You believe every dispute has a peaceful resolution. You address the court as "My Lord" or "Honourable Judge Orizu". Keep responses to 100-200 words. Be diplomatic, empathetic, and solution-focused. Propose fair terms.`,
  },
  ngozi: {
    name: 'Attorney Ngozi Adeyemi',
    role: 'Constitutional Counsel',
    initials: 'NA',
    color: '#059669',
    system: `You are Attorney Ngozi Adeyemi, an academic constitutional and estate governance law expert in the AreaConnect Estate Court of Justice. You cite estate bylaws, community codes, and legal precedents. You address the court as "My Lord" or "Honourable Judge Orizu". Keep responses to 150-250 words. Be thorough, methodical, and reference specific regulations.`,
  },
};

const JUDGE_SYSTEM = `You are Judge Orizu, the Honourable Presiding Judge of the AreaConnect Court of Justice. You are wise, fair, dramatic, and occasionally witty. You maintain order and deliver verdicts with gravitas. You consider evidence, jury recommendations, severity, and community impact. Use formal judicial language with occasional dry humour. Format your verdict as a structured legal pronouncement. Keep verdicts to 300-400 words.`;

async function getLawyerArgument({ persona, caseTitle, caseType, charges, plaintiffStatement, evidence, side, context }) {
  if (!process.env.GEMINI_API_KEY) return fallbackArgument(persona, side, caseTitle);
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: AI_PERSONAS[persona].system,
    });
    const prompt = `Case: "${caseTitle}" (${caseType})
Charges: ${charges.join(', ')}
Plaintiff's Statement: ${plaintiffStatement || 'Not provided'}
Evidence on record: ${evidence.map(e => `[${e.side}] ${e.label}: ${e.content}`).join('\n') || 'None yet'}
${context ? `\nContext: ${context}` : ''}

Deliver your ${side === 'prosecution' ? 'opening argument prosecuting this case' : side === 'defense' ? 'opening argument defending this case' : 'settlement proposal'} to the court.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('courtAI getLawyerArgument error:', err.message);
    return fallbackArgument(persona, side, caseTitle);
  }
}

async function getLawyerRebuttal({ persona, caseTitle, charges, evidence, opponentArgument, side }) {
  if (!process.env.GEMINI_API_KEY) return fallbackArgument(persona, side, caseTitle);
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: AI_PERSONAS[persona].system,
    });
    const prompt = `Case: "${caseTitle}"
Charges: ${charges.join(', ')}
Opponent just argued: "${opponentArgument}"
Evidence: ${evidence.map(e => `[${e.side}] ${e.label}: ${e.content}`).join('\n') || 'None'}

Deliver your rebuttal to the court.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('courtAI rebuttal error:', err.message);
    return fallbackArgument(persona, side, caseTitle);
  }
}

async function getJudgeVerdict({ caseTitle, caseType, charges, severity, plaintiffStatement, evidence, proceedings, juryVerdict, juryTally }) {
  if (!process.env.GEMINI_API_KEY) return fallbackVerdict(caseTitle);
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: JUDGE_SYSTEM,
    });

    const args = proceedings
      .filter(p => ['opening_statement','rebuttal','closing_argument'].includes(p.event))
      .map(p => `${p.actorName} (${p.role}): ${p.content}`)
      .join('\n\n');

    const prompt = `Case: "${caseTitle}" (${caseType})
Severity: ${severity}
Charges: ${charges.join(', ')}
Plaintiff Statement: ${plaintiffStatement || 'Not provided'}
Evidence: ${evidence.map(e => `[${e.side}] ${e.label}: ${e.content}`).join('\n') || 'None'}
Lawyer Arguments:\n${args || 'None submitted'}
Jury Recommendation: ${juryVerdict !== 'none' ? `${juryVerdict} (${juryTally.guilty} guilty / ${juryTally.notGuilty} not guilty / ${juryTally.abstain} abstain)` : 'No jury verdict'}

Deliver your final verdict. Include:
1. Your ruling (guilty/not_guilty/dismissed/mistrial)
2. Reasoning
3. If guilty: recommended fine amount in Naira and punishment type (none/warning/fine/marketplace_ban/lounge_suspension/community_suspension/estate_ban) and duration in days
4. End with "VERDICT: [GUILTY/NOT GUILTY/DISMISSED/MISTRIAL]" and if fine: "FINE: ₦[amount]" and if punishment: "PUNISHMENT: [type] for [N] days"`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse verdict, fine, punishment from text
    const verdictMatch = text.match(/VERDICT:\s*(GUILTY|NOT GUILTY|DISMISSED|MISTRIAL)/i);
    const fineMatch = text.match(/FINE:\s*₦?([\d,]+)/i);
    const punishmentMatch = text.match(/PUNISHMENT:\s*(\w+(?:_\w+)*)\s+for\s+(\d+)\s+days?/i);

    const decisionMap = {
      'GUILTY': 'guilty', 'NOT GUILTY': 'not_guilty',
      'DISMISSED': 'dismissed', 'MISTRIAL': 'mistrial',
    };
    const decision = verdictMatch ? (decisionMap[verdictMatch[1].toUpperCase()] || 'not_guilty') : 'not_guilty';
    const fine = fineMatch ? parseInt(fineMatch[1].replace(/,/g, ''), 10) : 0;
    const punishment = punishmentMatch ? punishmentMatch[1].toLowerCase() : 'none';
    const punishmentDays = punishmentMatch ? parseInt(punishmentMatch[2], 10) : 0;

    return { summary: text, decision, fine, punishment, punishmentDurationDays: punishmentDays };
  } catch (err) {
    console.error('courtAI verdict error:', err.message);
    return fallbackVerdict(caseTitle);
  }
}

async function getJudgeAppealRuling({ caseTitle, originalVerdict, appealReason }) {
  if (!process.env.GEMINI_API_KEY) return { granted: false, ruling: 'The appeal is denied. The original verdict stands.' };
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: JUDGE_SYSTEM,
    });
    const prompt = `Appeal in case "${caseTitle}".
Original verdict: ${originalVerdict}
Grounds for appeal: ${appealReason}

Rule on this appeal. Consider whether new grounds justify reconsideration. End with "APPEAL: GRANTED" or "APPEAL: DENIED".`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const granted = /APPEAL:\s*GRANTED/i.test(text);
    return { granted, ruling: text };
  } catch (err) {
    return { granted: false, ruling: 'The appeal is denied. The original verdict stands.' };
  }
}

async function getLawyerConsultation({ persona, side, caseTitle, caseType, charges, status, evidenceCount, proceedingCount, userMessage }) {
  const p = AI_PERSONAS[persona];
  if (!process.env.GEMINI_API_KEY) {
    return `Understood. As your private counsel, my advice is: ${side === 'prosecution' ? 'focus on the evidence and keep your statement factual and clear.' : 'stay calm, challenge every unproven claim, and remember — the burden of proof is on the plaintiff.'} — ${p.name}`;
  }
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: `${p.system}\n\nIMPORTANT: You are now in a PRIVATE CONSULTATION with your client — NOT addressing the court. Speak directly and confidentially to your client. Be strategic, practical, and supportive. Help them understand the situation and guide their next steps. Keep responses under 200 words.`,
    });
    const prompt = `PRIVATE CLIENT CONSULTATION
Case: "${caseTitle}" (${caseType})
Your role: ${side === 'prosecution' ? 'Prosecution counsel for the plaintiff' : 'Defense counsel for the defendant'}
Charges: ${(charges || []).join(', ') || 'None specified'}
Case status: ${status}
Evidence submitted so far: ${evidenceCount} item(s)
Proceedings logged: ${proceedingCount} event(s)

Your client says: "${userMessage}"

Give private, strategic legal advice. Be direct and practical.`;
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('getLawyerConsultation error:', err.message);
    return `Understood. Stay focused and trust the process. I'm building your case carefully. — ${p.name}`;
  }
}

async function getAdjournmentRuling({ caseTitle, reason, adjournmentCount }) {
  if (!process.env.GEMINI_API_KEY) {
    if (adjournmentCount >= 2) return { granted: false, ruling: `The application for adjournment is DENIED. This court has indulged ${adjournmentCount} delay(s) already. Justice cannot wait indefinitely. We proceed today. — Judge Orizu` };
    return { granted: true, ruling: `The application for adjournment is GRANTED. The hearing is adjourned for 3 days. Both parties are reminded that further delays will not be tolerated. Come prepared. — Judge Orizu` };
  }
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: JUDGE_SYSTEM,
    });
    const prompt = `Application for adjournment in: "${caseTitle}".
Reason given: "${reason}"
Previous adjournments in this case: ${adjournmentCount}
${adjournmentCount >= 2 ? 'NOTE: This case has already been adjourned multiple times.' : ''}

Rule on this application briefly. End your ruling with either "ADJOURNMENT: GRANTED" or "ADJOURNMENT: DENIED" on its own line.`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const granted = /ADJOURNMENT:\s*GRANTED/i.test(text) && adjournmentCount < 2;
    return { granted, ruling: text };
  } catch (err) {
    const granted = adjournmentCount < 1;
    return { granted, ruling: granted ? 'Adjournment granted. The hearing is adjourned for 3 days.' : 'Application denied. We proceed immediately.' };
  }
}

function fallbackArgument(persona, side, caseTitle) {
  const p = AI_PERSONAS[persona];
  if (side === 'prosecution') return `My Lord, the evidence before this court in the matter of "${caseTitle}" speaks plainly. The prosecution will demonstrate beyond reasonable doubt that the charges are well-founded. We shall proceed methodically through the facts. — ${p.name}`;
  if (side === 'defense') return `My Lord, the defense maintains that the charges in this matter are not supported by sufficient evidence. Every resident deserves the presumption of innocence. We shall challenge each allegation rigorously. — ${p.name}`;
  return `My Lord, both parties would benefit from an amicable resolution. The defense and prosecution have each presented compelling points. A settlement may serve the community's best interests. — ${p.name}`;
}

function fallbackVerdict(caseTitle) {
  return {
    summary: `Having carefully considered all evidence, testimonies, and arguments presented in the matter of "${caseTitle}", this court finds insufficient grounds to proceed. The case is dismissed without prejudice. Both parties are advised to seek amicable resolution. So ordered. — Judge Orizu`,
    decision: 'dismissed', fine: 0, punishment: 'none', punishmentDurationDays: 0,
  };
}

module.exports = { getLawyerArgument, getLawyerRebuttal, getJudgeVerdict, getJudgeAppealRuling, getLawyerConsultation, getAdjournmentRuling, AI_PERSONAS };
