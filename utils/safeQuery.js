// Helpers for user-facing queries.
//   escapeRx(q)  — literal, length-capped regex from user input (no ReDoS /
//                  regex injection)
//   PRIVATE_USER — fields never sent in lists (bank / wallet / secrets)
//   pageLimit    — cap ?limit
const escapeRx = (q, max = 80) => new RegExp(String(q || '').slice(0, max).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const PRIVATE_USER = '-passwordHash -refreshToken -accountNumber -bankCode -bankName -accountName -paystackRecipientCode -walletBalance -callCredits';
const pageLimit = (v, def = 20, max = 100) => Math.min(max, Math.max(1, parseInt(v, 10) || def));
module.exports = { escapeRx, PRIVATE_USER, pageLimit };
