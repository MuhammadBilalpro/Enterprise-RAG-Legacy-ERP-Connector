import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { ingest } from './core.js';

export async function extractPdf(buffer) {
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF signature');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/');
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw new Error('PDF limit is 100 pages');
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(`[Page ${n}]\n` + content.items.map(item => item.str || '').join(' '));
    }
    const text = pages.join('\n\n');
    if (text.replace(/\[Page \d+\]/g, '').trim().length < 10) throw new Error('No text layer found. Scanned PDFs need OCR before ingestion.');
    return text;
  } finally { await task.destroy(); }
}
export function slackText(value) {
  const messages = Array.isArray(value) ? value : value.messages;
  if (!Array.isArray(messages) || messages.length > 5000) throw new Error('Expected Slack messages array (maximum 5,000 messages)');
  return messages.filter(m => m && typeof m.text === 'string').map(m => `${String(m.ts || '').slice(0, 30)} ${String(m.user || 'unknown').slice(0, 100)}: ${m.text}`).join('\n');
}
export function seedLegacy(path) {
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,vendor TEXT,amount_cents INTEGER,currency TEXT,status TEXT,due_date TEXT);
    INSERT OR IGNORE INTO invoices VALUES('INV-1001','  Acme   Supplies  ',125000,'EUR',' overdue ','2026-09-30');
    INSERT OR IGNORE INTO invoices VALUES('INV-1002','Northwind Logistics',84000,'EUR','pending','2026-11-15');`);
  legacy.close();
}
export function syncLegacy(db, user, path) {
  // Fixed query, configured file, read-only connection; never execute user/LLM SQL.
  const legacy = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = legacy.prepare('SELECT id,vendor,amount_cents,currency,status,due_date FROM invoices ORDER BY id LIMIT 1000').all();
    return rows.map(row => ingest(db, user, { title: `Invoice ${row.id}`, source: 'erp', role: 'finance', text: `Invoice: ${row.id}\nVendor: ${row.vendor.trim()}\nAmount: ${(row.amount_cents / 100).toFixed(2)} ${row.currency}\nStatus: ${row.status.trim().toLowerCase()}\nDue date: ${row.due_date}` }));
  } finally { legacy.close(); }
}
