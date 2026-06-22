const PDFDocument = require('pdfkit');

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

const generateInvoicePdf = (inv) => {
  return new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W  = doc.page.width;   // 595
    const H  = doc.page.height;  // 842
    const M  = 40;               // margin
    const IW = W - M * 2;        // inner width

    const isReceipt   = inv.status === 'paid';
    const statusColor = STATUS_COLORS[inv.status] || STATUS_COLORS.pending;
    const statusLabel = (inv.status || 'PENDING').toUpperCase();

    // ── Page background ──────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(BGPAGE);

    // ── Header bar ──────────────────────────────────────────────────────────
    const HEADER_H = 100;
    doc.rect(M, M, IW, HEADER_H).fill(DARK);

    // Estate name
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(16)
       .text(inv.estate.name, M + 16, M + 16, { width: IW / 2 - 20 });
    doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
       .text('ESTATE MANAGEMENT', M + 16, M + 36, { width: IW / 2 - 20 });
    if (inv.estate.address) {
      doc.fillColor(LIGHT).font('Helvetica').fontSize(9)
         .text(inv.estate.address, M + 16, M + 52, { width: IW / 2 - 20 });
    }
    doc.fillColor([100, 220, 180]).font('Helvetica-Bold').fontSize(9)
       .text(`Code: ${inv.estate.estateCode}`, M + 16, M + 72);

    // Receipt / Invoice title block (right side)
    const rxStart = M + IW / 2;
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(26)
       .text(isReceipt ? 'RECEIPT' : 'INVOICE', rxStart + 10, M + 16, { width: IW / 2 - 16 });
    doc.fillColor(LIGHT).font('Helvetica').fontSize(10)
       .text(isReceipt ? 'Payment Confirmation' : 'Payment Request', rxStart + 10, M + 48, { width: IW / 2 - 16 });

    // Status badge
    const badgeX = rxStart + 10;
    const badgeY = M + 66;
    const badgeW = doc.widthOfString(statusLabel, { font: 'Helvetica-Bold', fontSize: 9 }) + 16;
    doc.roundedRect(badgeX, badgeY, badgeW, 16, 8).fill(statusColor);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9)
       .text(statusLabel, badgeX + 8, badgeY + 3);

    // ── AreaConnect brand ────────────────────────────────────────────────────
    const brandY = M + HEADER_H + 10;
    doc.fillColor([17, 24, 39]).font('Helvetica-Bold').fontSize(13)
       .text('Area', M, brandY, { continued: true })
       .fillColor(GREEN).text('Connect', { continued: false });

    // ── Bill To + Invoice Meta ───────────────────────────────────────────────
    const sectionY = brandY + 20;
    const colW     = IW / 2 - 6;

    // Left: Bill To
    doc.rect(M, sectionY, colW, 100).fill(WHITE);
    doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(8)
       .text('BILL TO', M + 12, sectionY + 10);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
       .text(inv.resident.name, M + 12, sectionY + 24);
    let billY = sectionY + 40;
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
    doc.rect(metaX, sectionY, colW, 100).fill(WHITE);

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

    // ── Line items table ─────────────────────────────────────────────────────
    const tableY = sectionY + 108;
    const cols   = [
      { label: 'Description', x: M,       w: IW * 0.32, align: 'left'  },
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
    const summaryY = rowY + 8;
    const totW     = 200;
    const totX     = M + IW - totW;

    // Notes (left side)
    if (inv.notes) {
      doc.rect(M, summaryY, IW - totW - 20, 60).fill([248, 250, 252]);
      doc.rect(M, summaryY, 3, 60).fill(GREEN);
      doc.fillColor(SLATE).font('Helvetica').fontSize(9)
         .text(inv.notes, M + 10, summaryY + 8, { width: IW - totW - 36, lineGap: 2 });
    }

    // Totals box
    doc.fillColor(SLATE).font('Helvetica').fontSize(11)
       .text('Subtotal', totX, summaryY + 6, { width: totW, continued: true })
       .font('Helvetica').fillColor(DARK)
       .text(fmtNGN(inv.subtotal), { align: 'right' });

    doc.fillColor(SLATE).font('Helvetica').fontSize(11)
       .text('VAT (0%)', totX, summaryY + 24, { width: totW, continued: true })
       .fillColor(DARK)
       .text(fmtNGN(0), { align: 'right' });

    // Total divider
    doc.moveTo(totX, summaryY + 42).lineTo(totX + totW, summaryY + 42).lineWidth(1.5).strokeColor(DARK).stroke();

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
       .text('TOTAL', totX, summaryY + 48, { width: totW, continued: true })
       .fillColor(GREEN)
       .text(fmtNGN(inv.total), { align: 'right' });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footY = summaryY + 90;
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
