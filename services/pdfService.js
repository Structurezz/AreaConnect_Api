const PDFDocument = require('pdfkit');
const axios       = require('axios');

const fmtNGN  = (n) => `NGN ${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const METHOD_LABELS = {
  cash: 'Cash', bank_transfer: 'Bank Transfer',
  paystack: 'Paystack (Online)', manual: 'Manual Entry',
};
const FREQ_LABELS = {
  one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual',
};
const STATUS_COLORS = {
  paid:    [5, 150, 105],
  pending: [217, 119, 6],
  overdue: [220, 38, 38],
  waived:  [107, 114, 128],
};

const GREEN  = [16, 185, 129];
const DARK   = [15, 23, 42];
const SLATE  = [100, 116, 139];
const LIGHT  = [148, 163, 184];
const WHITE  = [255, 255, 255];
const BGPAGE = [240, 244, 248];

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://estatemanager.areaconnect.pro';
const DEFAULT_HERO = `${FRONTEND_URL}/estate-hero.jpeg`;

async function fetchImageBuffer(url) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

const generateInvoicePdf = async (inv) => {
  // Determine hero image URL (same logic as HTML version)
  const heroUrl = (inv.estate?.logoUrl && inv.estate.logoUrl.startsWith('http'))
    ? inv.estate.logoUrl
    : DEFAULT_HERO;

  const heroBuffer = await fetchImageBuffer(heroUrl);

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W  = doc.page.width;   // 595
    const H  = doc.page.height;  // 842
    const M  = 40;
    const IW = W - M * 2;

    const isReceipt   = inv.status === 'paid';
    const statusColor = STATUS_COLORS[inv.status] || STATUS_COLORS.pending;
    const statusLabel = (inv.status || 'PENDING').toUpperCase();

    // ── Page background ──────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(BGPAGE);

    // ── Header ──────────────────────────────────────────────────────────────
    const HEADER_H = 130;
    const halfW    = IW / 2;
    const imgX     = M + halfW;
    const imgW     = halfW;

    // Left half: dark estate info panel
    doc.rect(M, M, halfW, HEADER_H).fill(DARK);

    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(16)
       .text(inv.estate.name, M + 16, M + 18, { width: halfW - 24 });
    doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
       .text('ESTATE MANAGEMENT', M + 16, M + 38, { width: halfW - 24 });
    if (inv.estate.address) {
      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text(inv.estate.address, M + 16, M + 54, { width: halfW - 24, lineGap: 1 });
    }
    doc.fillColor([100, 220, 180]).font('Helvetica-Bold').fontSize(9)
       .text(`Code: ${inv.estate.estateCode}`, M + 16, M + 98);

    // Right half: hero image + dark overlay + RECEIPT/INVOICE text
    if (heroBuffer) {
      // Clip to right half rectangle
      doc.save();
      doc.rect(imgX, M, imgW, HEADER_H).clip();
      doc.image(heroBuffer, imgX, M, { width: imgW, height: HEADER_H, cover: [imgW, HEADER_H] });
      doc.restore();
    } else {
      // Fallback: solid dark-blue if image unavailable
      doc.rect(imgX, M, imgW, HEADER_H).fill([30, 58, 95]);
    }

    // Dark gradient overlay on top of image (simulate linear-gradient)
    doc.save();
    doc.rect(imgX, M, imgW, HEADER_H).clip();
    // Left side of the overlay is denser — approximate with two rects at different opacity
    doc.fillOpacity(0.82).rect(imgX, M, imgW * 0.55, HEADER_H).fill(DARK);
    doc.fillOpacity(0.30).rect(imgX + imgW * 0.55, M, imgW * 0.45, HEADER_H).fill(DARK);
    doc.restore();
    doc.fillOpacity(1); // reset

    // RECEIPT / INVOICE title
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(26)
       .text(isReceipt ? 'RECEIPT' : 'INVOICE', imgX + 12, M + 18, { width: imgW - 20 });
    doc.fillColor([255, 255, 255]).fillOpacity(0.65).font('Helvetica').fontSize(10)
       .text(isReceipt ? 'Payment Confirmation' : 'Payment Request', imgX + 12, M + 52, { width: imgW - 20 });
    doc.fillOpacity(1);

    // Status badge
    const badgeX = imgX + 12;
    const badgeY = M + 72;
    const badgeW = doc.widthOfString(statusLabel, { font: 'Helvetica-Bold', fontSize: 9 }) + 16;
    doc.roundedRect(badgeX, badgeY, badgeW, 18, 9).fill(statusColor);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9)
       .text(statusLabel, badgeX + 8, badgeY + 4);

    // ── AreaConnect brand ────────────────────────────────────────────────────
    const brandY = M + HEADER_H + 10;
    doc.fillColor([17, 24, 39]).font('Helvetica-Bold').fontSize(13)
       .text('Area', M, brandY, { continued: true })
       .fillColor(GREEN).text('Connect', { continued: false });

    // ── Bill To + Invoice Meta ───────────────────────────────────────────────
    const sectionY = brandY + 20;
    const colW     = IW / 2 - 6;

    // Left: Bill To
    doc.rect(M, sectionY, colW, 110).fill(WHITE);
    doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(8)
       .text('BILL TO', M + 12, sectionY + 10);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
       .text(inv.resident.name, M + 12, sectionY + 24);
    let billY = sectionY + 42;
    if (inv.resident.unit && inv.resident.unit !== 'N/A') {
      doc.fillColor(SLATE).font('Helvetica').fontSize(10)
         .text(`Unit: ${inv.resident.unit}`, M + 12, billY);
      billY += 14;
    }
    doc.fillColor(SLATE).font('Helvetica').fontSize(10)
       .text(inv.estate.name, M + 12, billY);
    billY += 14;
    if (inv.resident.email) {
      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text(inv.resident.email, M + 12, billY);
      billY += 13;
    }
    if (inv.resident.phone) {
      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text(inv.resident.phone, M + 12, billY);
    }

    // Right: Invoice Meta
    const metaX = M + colW + 12;
    doc.rect(metaX, sectionY, colW, 110).fill(WHITE);

    const metaRows = [
      ['Invoice No:', inv.invoiceNumber],
      ['Date Issued:', fmtDate(inv.date)],
      ['Due Date:', fmtDate(inv.dueDate)],
      inv.paidAt     ? ['Date Paid:', fmtDate(inv.paidAt)]                          : null,
      inv.method     ? ['Payment Method:', METHOD_LABELS[inv.method] || inv.method] : null,
      inv.recordedBy ? ['Recorded By:', inv.recordedBy]                             : null,
    ].filter(Boolean);

    let metaRowY = sectionY + 10;
    for (const [label, val] of metaRows) {
      doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(9)
         .text(label, metaX + 12, metaRowY, { width: colW / 2 - 4 });
      doc.fillColor(DARK).font('Helvetica').fontSize(9)
         .text(String(val), metaX + colW / 2 + 4, metaRowY, { width: colW / 2 - 8 });
      metaRowY += 16;
    }

    // ── Divider ──────────────────────────────────────────────────────────────
    const divY = sectionY + 118;
    doc.moveTo(M, divY).lineTo(M + IW, divY).lineWidth(2).strokeColor([226, 232, 240]).stroke();

    // ── Line items table ─────────────────────────────────────────────────────
    const tableY = divY + 6;
    const cols   = [
      { label: 'Description', x: M,             w: IW * 0.32, align: 'left'  },
      { label: 'Freq.',       x: M + IW * 0.32, w: IW * 0.12, align: 'right' },
      { label: 'Qty',         x: M + IW * 0.44, w: IW * 0.08, align: 'right' },
      { label: 'Unit Price',  x: M + IW * 0.52, w: IW * 0.18, align: 'right' },
      { label: 'VAT %',       x: M + IW * 0.70, w: IW * 0.10, align: 'right' },
      { label: 'Amount',      x: M + IW * 0.80, w: IW * 0.20, align: 'right' },
    ];

    // Header row
    doc.rect(M, tableY, IW, 24).fill(DARK);
    for (const col of cols) {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9)
         .text(col.label, col.x + 6, tableY + 7, { width: col.w - 8, align: col.align });
    }

    // Item rows
    let rowY = tableY + 24;
    for (let i = 0; i < inv.items.length; i++) {
      const item    = inv.items[i];
      const rowH    = item.detail ? 32 : 22;
      const rowFill = i % 2 === 0 ? [248, 250, 252] : WHITE;
      doc.rect(M, rowY, IW, rowH).fill(rowFill);

      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
         .text(item.description, cols[0].x + 6, rowY + 5, { width: cols[0].w - 10 });
      if (item.detail) {
        doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
           .text(item.detail, cols[0].x + 6, rowY + 18, { width: cols[0].w - 10 });
      }
      doc.fillColor(SLATE).font('Helvetica').fontSize(9)
         .text(FREQ_LABELS[item.frequency] || '—', cols[1].x + 4, rowY + 7, { width: cols[1].w - 6, align: 'right' });
      doc.fillColor(DARK).font('Helvetica').fontSize(10)
         .text(String(item.quantity), cols[2].x + 4, rowY + 7, { width: cols[2].w - 6, align: 'right' });
      doc.fillColor(DARK).font('Helvetica').fontSize(10)
         .text(fmtNGN(item.unitPrice), cols[3].x + 4, rowY + 7, { width: cols[3].w - 6, align: 'right' });
      doc.fillColor(SLATE).font('Helvetica').fontSize(9)
         .text(`${item.vat}%`, cols[4].x + 4, rowY + 7, { width: cols[4].w - 6, align: 'right' });
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
         .text(fmtNGN(item.total), cols[5].x + 4, rowY + 7, { width: cols[5].w - 8, align: 'right' });

      rowY += rowH;
    }

    // ── Totals + Notes ───────────────────────────────────────────────────────
    const summaryY = rowY + 10;
    const totW     = 200;
    const totX     = M + IW - totW;

    if (inv.notes) {
      doc.rect(M, summaryY, IW - totW - 20, 64).fill([248, 250, 252]);
      doc.rect(M, summaryY, 3, 64).fill(GREEN);
      doc.fillColor(SLATE).font('Helvetica').fontSize(9)
         .text(inv.notes, M + 10, summaryY + 8, { width: IW - totW - 36, lineGap: 2 });
    }

    doc.fillColor(SLATE).font('Helvetica').fontSize(11)
       .text('Subtotal', totX, summaryY + 6, { width: totW, continued: true })
       .fillColor(DARK).text(fmtNGN(inv.subtotal), { align: 'right' });

    doc.fillColor(SLATE).font('Helvetica').fontSize(11)
       .text('VAT (0%)', totX, summaryY + 24, { width: totW, continued: true })
       .fillColor(DARK).text(fmtNGN(0), { align: 'right' });

    doc.moveTo(totX, summaryY + 42).lineTo(totX + totW, summaryY + 42).lineWidth(1.5).strokeColor(DARK).stroke();

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
       .text('TOTAL', totX, summaryY + 50, { width: totW, continued: true })
       .fillColor(GREEN).text(fmtNGN(inv.total), { align: 'right' });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footY = summaryY + 96;
    doc.rect(M, footY, IW, 28).fill([248, 250, 252]);
    doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
       .text('Generated by ', M + 12, footY + 9, { continued: true })
       .font('Helvetica-Bold').fillColor(GREEN).text('AreaConnect', { continued: true })
       .font('Helvetica').fillColor(LIGHT).text(' Estate Management');
    doc.fillColor([203, 213, 225]).font('Helvetica').fontSize(9)
       .text(inv.invoiceNumber, M + IW - 120, footY + 9, { width: 108, align: 'right' });

    doc.end();
  });
};

module.exports = { generateInvoicePdf };
