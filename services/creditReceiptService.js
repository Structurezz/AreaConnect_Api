const User = require('../models/User');
require('../models/Unit'); // registered for populate('unitId') — don't rely on load order
const CreditTransaction = require('../models/CreditTransaction');
const { generateInvoicePdf } = require('./pdfService');
const { sendCreditReceiptEmail } = require('./emailService');
const { CREDIT_PACKS } = require('../utils/credits');

// Receipts for call credits — both purchases (Paystack top-ups) and bonus
// credits gifted by AreaConnect. One builder feeds the emailed PDF and the
// in-app "download receipt", so they always match.

// What a credit is worth when shown on a gift receipt (the base pack rate).
const NAIRA_PER_CREDIT = CREDIT_PACKS[0].price / CREDIT_PACKS[0].credits;

const ISSUER = {
  name: 'AreaConnect',
  address: 'Area Connector Technologies · RC 9607864',
  estateCode: 'Call credits',
  logoUrl: '',
};

const invoiceNumberFor = (tx) => {
  const d = new Date(tx.createdAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
  return `CRD-${d}-${String(tx._id).slice(-6).toUpperCase()}`;
};

/** inv object in the shape pdfService.generateInvoicePdf expects. */
function buildCreditInvoice(tx, user) {
  const isGift = tx.type === 'grant';
  const credits = Math.abs(tx.amount);
  const date = tx.createdAt || new Date();
  const unit = user.unitId
    ? `${user.unitId.unitNumber}${user.unitId.block ? ` (Block ${user.unitId.block})` : ''}` // PDF prefixes "Unit:"
    : 'N/A';
  const note = isGift ? (tx.description || '').replace(/^Bonus from AreaConnect( — )?/, '') : '';

  let items;
  let total;
  if (isGift) {
    const value = Math.round(credits * NAIRA_PER_CREDIT);
    items = [
      { description: `${credits} call credits`, detail: `Bonus airtime · about ${credits} min of neighbour calls`, frequency: 'one_time', quantity: 1, unitPrice: value, vat: 0, total: value },
      { description: 'AreaConnect gift credit', detail: note || 'A gift from AreaConnect', frequency: 'one_time', quantity: 1, unitPrice: -value, vat: 0, total: -value },
    ];
    total = 0;
  } else {
    const paid = tx.amountPaid || 0;
    items = [
      { description: `${credits} call credits`, detail: `${tx.description || 'Credit top-up'} · about ${credits} min of neighbour calls`, frequency: 'one_time', quantity: 1, unitPrice: paid, vat: 0, total: paid },
    ];
    total = paid;
  }

  return {
    invoiceNumber: invoiceNumberFor(tx),
    date, dueDate: date, paidAt: date,
    status: 'paid',
    method: isGift ? 'comp' : 'paystack',
    recordedBy: isGift ? 'AreaConnect team' : null,
    estate: ISSUER,
    resident: { name: user.name, unit, email: user.email, phone: user.phone || '' },
    items,
    subtotal: total,
    total,
    notes: isGift
      ? `Complimentary call credits from AreaConnect${note ? ` — ${note}` : ''}. Nothing to pay. Credits never expire; calls to security and estate management are always free.`
      : `Paid via Paystack${tx.reference ? ` (ref ${tx.reference})` : ''}. Credits never expire; 1 credit = 1 minute of neighbour calls. Calls to security and estate management are always free.`,
    meta: { isGift, credits, balanceAfter: tx.balanceAfter, note },
  };
}

const loadUser = (userId) =>
  User.findById(userId).select('name email phone unitId').populate('unitId', 'unitNumber block').lean();

/** Generate the PDF for one credit transaction (purchase or gift). */
async function creditReceiptPdf(tx, user) {
  const inv = buildCreditInvoice(tx, user || (await loadUser(tx.userId)));
  return { inv, pdf: await generateInvoicePdf(inv) };
}

/** Email the receipt (with PDF) for a top-up or gift. Never throws. */
async function emailCreditReceipt(txOrId) {
  try {
    // A full ledger row has a `type`; anything else is an id (note: ObjectIds
    // expose `_id` themselves, so that can't be used to tell them apart).
    const tx = txOrId?.type ? txOrId : await CreditTransaction.findById(txOrId).lean();
    if (!tx || !['topup', 'grant'].includes(tx.type)) return;
    const user = await loadUser(tx.userId);
    if (!user?.email) return;
    const { inv, pdf } = await creditReceiptPdf(tx, user);
    await sendCreditReceiptEmail({ to: user.email, name: user.name, inv, pdf });
    return true;
  } catch (e) {
    console.error('[credit receipt email]', e.message);
    return false;
  }
}

/**
 * Email many receipts in the background (gift to a whole estate). Resend's
 * batch API can't carry attachments, so these go one at a time, paced under
 * the rate limit.
 */
function emailCreditReceiptsInBackground(txIds) {
  (async () => {
    for (const id of txIds) {
      await emailCreditReceipt(id);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (txIds.length > 1) console.log(`[credit receipt email] sent ${txIds.length} gift receipts`);
  })();
}

module.exports = { buildCreditInvoice, creditReceiptPdf, emailCreditReceipt, emailCreditReceiptsInBackground, invoiceNumberFor };
