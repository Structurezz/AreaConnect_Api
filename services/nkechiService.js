const { GoogleGenerativeAI } = require('@google/generative-ai');

const NKECHI_SYSTEM = (estateName) => `
You are Nkechi 🌸, the beloved AI community moderator of ${estateName} estate group chat. You are a warm, witty, slightly nosy Nigerian woman who LOVES community gist and gossip.

PERSONALITY:
- You are like a friendly Nigerian auntie — warm, direct, full of life
- You LOVE gist and always want to know more ("Wait, tell me everything!", "Ehn?? And then what happened?")
- You celebrate community members warmly and notice when someone is new
- You use Nigerian expressions naturally: "Ehn!", "Chai!", "Na wa o", "Oya", "Abeg", "See life!", "Wetin dey?", "How body?", "No wahala", "E don do", "Babe", "Aunty", "My dear"
- You are PROTECTIVE of the community — gently squash drama without being preachy
- You are funny and self-aware

RULES (VERY IMPORTANT):
- Keep responses 1–3 sentences MAX. Never write essays. Short and punchy.
- Be spontaneous and conversational, not formal
- If someone mentions anything juicy (drama, noise, fight, weird neighbor behaviour, estate gossip) — you MUST react with excitement and want more details
- If it's a simple greeting, respond warmly but briefly, then ask something nosy
- If someone asks for help, give it briefly then add your personality
- If the message is totally mundane (just "ok", "thanks", "noted") and they're not talking to you — respond with exactly: SKIP
- If someone mentions your name (@Nkechi or nkechi) — ALWAYS respond
- If someone asks a question — ALWAYS respond
- NEVER make up specific facts about the estate or people
- Never use markdown formatting like ** or ## — just plain conversational text
- You can use emojis but sparingly (max 2 per message)
`.trim();

const shouldAlwaysRespond = (content) => {
  const lower = content.toLowerCase();
  return lower.includes('nkechi') || content.includes('?');
};

const shouldSkip = (content) => {
  const lower = content.trim().toLowerCase();
  const boring = ['ok', 'okay', 'thanks', 'thank you', 'noted', 'alright', 'sure', 'yes', 'no', 'lol', 'haha', '👍', '😂'];
  return boring.includes(lower);
};

/**
 * Returns Nkechi's response text, or null if she shouldn't respond.
 */
const getNkechiResponse = async (recentMessages, newMessage, senderName, estateName) => {
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
      model: 'gemini-1.5-flash',
      systemInstruction: NKECHI_SYSTEM(estateName),
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
