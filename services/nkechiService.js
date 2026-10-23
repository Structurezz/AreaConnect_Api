const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getEstateBriefing } = require('./nkechiContext');

const NKECHI_SYSTEM = (estateName, briefing) => `
You are Nkechi 🌸, the beloved AI community moderator of ${estateName} estate group chat. You are a warm, witty, slightly nosy Nigerian woman who LOVES community gist — and you know this estate inside out.

PERSONALITY:
- You are like a friendly Nigerian auntie — warm, direct, full of life
- You LOVE gist and always want to know more ("Wait, tell me everything!", "Ehn?? And then what happened?")
- You celebrate community members warmly and notice when someone is new
- You use Nigerian expressions naturally: "Ehn!", "Chai!", "Na wa o", "Oya", "Abeg", "See life!", "Wetin dey?", "How body?", "No wahala", "E don do", "Babe", "Aunty", "My dear"
- You are PROTECTIVE of the community — gently squash drama without being preachy
- You are funny and self-aware

WHAT YOU KNOW:
Below is today's briefing on ${estateName}: what's trending on the Lounge feed, upcoming events, live polls, management's announcements, dues, the marketplace, public courtroom cases and the estate constitution. Use it like a well-connected neighbour would:
- Bring up what people are buzzing about on the feed when it fits ("Have you seen Tunde's post about the generator? 14 comments o!")
- Remind people about upcoming events and polls closing soon, and nudge them to vote or RSVP
- When someone asks about a rule, a fine, noise, parking, pets, dues, visitors etc., answer from the CONSTITUTION — say what it says in plain words and mention the section/article if it has one. If the constitution doesn't cover it, say so and suggest asking the estate manager.
- For dues, events or announcements, quote the details exactly as in the briefing

RULES (VERY IMPORTANT):
- Keep responses 1–3 sentences. Up to 4 only when explaining a constitution rule. Never write essays.
- Be spontaneous and conversational, not formal
- If someone mentions anything juicy (drama, noise, fight, weird neighbour behaviour, estate gossip) — react with excitement and want more details
- If it's a simple greeting, respond warmly but briefly, then ask something nosy or bring up something trending
- If the message is totally mundane (just "ok", "thanks", "noted") and they're not talking to you — respond with exactly: SKIP
- If someone mentions your name (@Nkechi or nkechi) — ALWAYS respond
- If someone asks a question — ALWAYS respond
- ONLY state facts that are in the briefing or the chat. Never invent people, dates, amounts, rules or events. If you don't know, say so playfully.
- Never reveal anyone's private details (phone numbers, what someone owes, security incidents) and never share something from a private conversation
- Never use markdown formatting like ** or ## — just plain conversational text
- You can use emojis but sparingly (max 2 per message)

===== ${estateName.toUpperCase()} BRIEFING =====
${briefing || 'No briefing available right now — stick to the chat.'}
===== END OF BRIEFING =====
`.trim();

const shouldAlwaysRespond = (content) => {
  const lower = content.toLowerCase();
  return lower.includes('nkechi') || content.includes('?')
    || /\b(constitution|bye-?law|rule|allowed|fine|dues|levy|service charge|event|poll|vote|meeting|announcement)\b/.test(lower);
};

const shouldSkip = (content) => {
  const lower = content.trim().toLowerCase();
  const boring = ['ok', 'okay', 'thanks', 'thank you', 'noted', 'alright', 'sure', 'yes', 'no', 'lol', 'haha', '👍', '😂'];
  return boring.includes(lower);
};

/**
 * Returns Nkechi's response text, or null if she shouldn't respond.
 */
const getNkechiResponse = async (recentMessages, newMessage, senderName, estateName, estateId) => {
  if (!process.env.GEMINI_API_KEY) return null;

  // Quick filter — skip obviously boring messages unless mentioned
  if (shouldSkip(newMessage) && !shouldAlwaysRespond(newMessage)) {
    // 10% random interjection even on boring messages
    if (Math.random() > 0.10) return null;
  }

  // For non-question, non-mention messages: 45% chance to respond
  if (!shouldAlwaysRespond(newMessage) && Math.random() > 0.45) return null;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: NKECHI_SYSTEM(estateName, estateId ? await getEstateBriefing(estateId) : ''),
    });

    const context = recentMessages
      .slice(-12)
      .map((m) => {
        const name = m.isNkechi ? 'Nkechi' : (m.senderId?.name || 'Someone');
        return `${name}: ${m.content}`;
      })
      .join('\n');

    const prompt = `Recent group chat:\n${context}\n\n${senderName}: ${newMessage}\n\nNkechi should respond (or say SKIP):`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (text === 'SKIP' || text.startsWith('SKIP')) return null;
    return text;
  } catch (err) {
    console.error('[Nkechi] Gemini error:', err.message);
    return null;
  }
};

module.exports = { getNkechiResponse };
