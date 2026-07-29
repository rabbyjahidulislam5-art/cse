import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export type ReportFormat = 'csv' | 'excel' | 'pdf';

export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
}

// Generic tabular report builder (CSV / Excel / PDF) reused across Audit Logs, Collection
// Analytics, Sales Ledger, and any future export button — mirrors the same convention already
// established by generateDisputeReportFile in routes/disputes/shared.ts, just parameterized so
// new report types don't need to hand-roll their own writer.
export async function generateTabularReport(opts: {
  title: string;
  format: ReportFormat;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  uploadsSubdir: string; // e.g. 'audit-reports'
  filenamePrefix: string; // e.g. 'audit-log'
}): Promise<string> {
  const { title, format, columns, rows, uploadsSubdir, filenamePrefix } = opts;
  const dir = path.join(__dirname, `../../uploads/${uploadsSubdir}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  const filename = `${filenamePrefix}-${Date.now()}`;

  if (format === 'csv') {
    const escape = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [columns.map(c => escape(c.label)).join(',')];
    for (const row of rows) lines.push(columns.map(c => escape(row[c.key])).join(','));
    const filePath = path.join(dir, `${filename}.csv`);
    fs.writeFileSync(filePath, lines.join('\n'));
    return `${backendUrl}/uploads/${uploadsSubdir}/${filename}.csv`;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title.slice(0, 31));
    sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: c.width || 20 }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    const filePath = path.join(dir, `${filename}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return `${backendUrl}/uploads/${uploadsSubdir}/${filename}.xlsx`;
  }

  // PDF — simple tabular summary, landscape A4, matching the dispute report's layout.
  const filePath = path.join(dir, `${filename}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(16).font('Helvetica-Bold').text(`Smart Campus — ${title}`, { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })} — ${rows.length} record(s)`, { align: 'center' });
    doc.moveDown(1).fillColor('#000');

    const pageWidth = 760;
    const colWidth = pageWidth / columns.length;
    const colX = columns.map((_, i) => 40 + i * colWidth);

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8);
      columns.forEach((c, i) => doc.text(c.label, colX[i], doc.y, { width: colWidth - 4 }));
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(7.5);
    };
    drawHeader();

    for (const row of rows) {
      const y = doc.y;
      columns.forEach((c, i) => doc.text(String(row[c.key] ?? ''), colX[i], y, { width: colWidth - 4 }));
      doc.moveDown(0.4);
      if (doc.y > 520) {
        doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
        drawHeader();
      }
    }
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return `${backendUrl}/uploads/${uploadsSubdir}/${filename}.pdf`;
}
