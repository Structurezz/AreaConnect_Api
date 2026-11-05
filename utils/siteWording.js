// Server messages and notifications are written in estate words ("unit",
// "resident", "estate"). For other site types reword them with the site's
// TERMS (utils/siteTypes) so a hospital reads "ward" and "patient / staff",
// a hotel "room" and "guest", and so on. Estates are left untouched.
const { TERMS, normType, siteFor } = require('./siteTypes');

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Match the case of the original word: "Unit" → "Ward", "unit" → "ward", "UNIT" → "WARD"
const matchCase = (orig, word) => (orig === orig.toUpperCase() && orig.length > 1 ? word.toUpperCase()
  : orig[0] === orig[0].toUpperCase() ? capital(word) : lower(word));

function rules(t) {
  const unit = t.unit, units = t.units;
  return [
    [/\bestate managers\b/gi, t.manager === 'Front desk' ? 'front desk team' : `${t.manager}s`],
    [/\bestate manager\b/gi, t.manager],
    [/\bestate management\b/gi, `${t.site} management`],
    [/\bestate office\b/gi, `${t.site} office`],
    [/\bestate bills\b/gi, t.dues],
    [/\bestates\b/gi, t.sites],
    [/\bestate\b/gi, t.site],
    [/\bapartments\b/gi, units],
    [/\bapartment\b/gi, unit],
    [/\bunits\b/gi, units],
    [/\bunit\b/gi, unit],
    [/\bresidents\b/gi, t.members],
    [/\bresident\b/gi, t.member],
    [/\bhouseholds\b/gi, t.household],
    [/\bhousehold\b/gi, t.household],
    [/\bfamily members\b/gi, t.familyPlural],
    [/\bfamily member\b/gi, t.family],
  ];
}

const cache = {};
function reword(text, type) {
  if (typeof text !== 'string' || !text) return text;
  const k = normType(type);
  if (k === 'estate') return text;
  const list = (cache[k] ??= rules(TERMS[k]));
  let out = text;
  for (const [rx, word] of list) out = out.replace(rx, (m) => matchCase(m, word));
  if (out === text) return out;
  const t = TERMS[k];
  if (['Class', 'Department', 'Ward'].includes(t.unit)) out = out.replace(/\blives in\b/g, 'belongs to').replace(/\blive in\b/g, 'belong to');
  if (t.site === 'Campus') out = out.replace(/\bin (this|the|your) campus\b/gi, (m, w) => `on ${w} campus`);
  // Fix articles after a swap: "an unit" → "a ward", "a apartment" → "an apartment"
  return out
    .replace(/\b([Aa]) ([aeiou]\w*)/g, (m, a, w) => (/^(uni|use|one|eu)/i.test(w) ? m : `${a}n ${w}`))
    .replace(/\b([Aa])n ([^aeiou\W]\w*)/g, (m, a, w) => (/^h(our|onou?r|eir)/i.test(w) ? m : `${a} ${w}`))
    .replace(/\b([Aa])n ((?:uni|use|one|eu)\w*)/gi, (m, a, w) => `${a} ${w}`);
}

const siteTypeOf = async (estateId) => (estateId ? (await siteFor(estateId))?.site?.type || 'estate' : 'estate');

// Express: reword `message` (and nested data.message) of JSON responses
function rewordResponses(type) {
  if (normType(type) === 'estate') return null;
  return (body) => {
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string') body.message = reword(body.message, type);
      if (Array.isArray(body.errors)) body.errors = body.errors.map(e => (e && typeof e.msg === 'string' ? { ...e, msg: reword(e.msg, type) } : e));
    }
    return body;
  };
}

// Notifications: title / body
async function rewordNotification(estateId, n) {
  const type = await siteTypeOf(estateId);
  if (normType(type) === 'estate' || !n) return n;
  return { ...n, ...(n.title && { title: reword(n.title, type) }), ...(n.body && { body: reword(n.body, type) }) };
}

module.exports = { reword, rewordResponses, rewordNotification, siteTypeOf };
