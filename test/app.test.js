import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, addUser, login, session, clean, chunks, ingest, search, createReview, deleteDocument } from '../src/core.js';
import { seedLegacy, syncLegacy, slackText, extractPdf } from '../src/connectors.js';
import { buildServer } from '../src/server.js';

function fixture() {
  const db = openStore();
  for (const role of ['admin', 'finance', 'employee']) addUser(db, role, role, `${role}-password-2026`);
  const users = Object.fromEntries(['admin', 'finance', 'employee'].map(role => [role, login(db, role, `${role}-password-2026`).user]));
  return { db, ...users };
}
test('cleaning, chunk overlap, Slack extraction', () => {
  assert.equal(clean('  Hello\r\nworld\u0000    team  '), 'Hello\nworld team');
  const parts = chunks('x'.repeat(2400)); assert.equal(parts.length, 3); assert.equal(parts[0].slice(-180), parts[1].slice(0, 180));
  assert.match(slackText([{ user: 'U1', text: 'delivery update' }]), /U1: delivery update/);
  assert.throws(() => slackText({ nope: [] }));
});
test('authentication rejects bad credentials and expires sessions', () => {
  const { db } = fixture();
  assert.equal(login(db, 'admin', 'wrong'), null);
  const result = login(db, 'employee', 'employee-password-2026');
  assert.equal(session(db, result.token).role, 'employee');
  assert.equal(session(db, 'forged'), undefined);
  db.exec('UPDATE sessions SET expires=0'); assert.equal(session(db, result.token), undefined); db.close();
});
test('RBAC precedes retrieval; direct action bypass and duplicate actions are blocked', () => {
  const { db, admin, finance, employee } = fixture();
  const input = { title: 'Secret invoice', source: 'erp', role: 'finance', text: 'Acme invoice overdue amount 1250 EUR confidential' };
  const doc = ingest(db, admin, input);
  assert.equal(ingest(db, admin, input).duplicate, true);
  assert.equal(search(db, employee, 'Acme confidential').length, 0);
  assert.equal(search(db, finance, 'Acme')[0].document_id, doc.id);
  assert.throws(() => ingest(db, finance, input), /Admin/);
  assert.throws(() => createReview(db, employee, doc.id), /Finance/);
  const hidden = ingest(db, admin, { ...input, title: 'Board invoice', role: 'admin' });
  assert.throws(() => createReview(db, finance, hidden.id), /unavailable/);
  assert.equal(createReview(db, finance, doc.id).id, createReview(db, finance, doc.id).id);
  deleteDocument(db, admin, doc.id);
  assert.equal(search(db, finance, 'Acme').length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0);
  assert.ok(db.prepare("SELECT * FROM audit WHERE event='delete_document'").get()); db.close();
});
test('legacy SQL imports normalize records and repeated sync is idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-test-'));
  const { db, admin, finance } = fixture();
  try {
    const path = join(directory, 'erp.sqlite'); seedLegacy(path);
    assert.equal(syncLegacy(db, admin, path).length, 2);
    assert.ok(syncLegacy(db, admin, path).every(row => row.duplicate));
    assert.match(search(db, finance, 'overdue')[0].text, /1250.00 EUR/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('PDF extraction reads a text-layer PDF and rejects invalid input', async () => {
  const stream = 'BT /F1 12 Tf 30 100 Td (Invoice ACME amount EUR 1250 overdue) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await extractPdf(Buffer.from(pdf)), /Invoice ACME/);
  await assert.rejects(extractPdf(Buffer.from('not pdf')), /signature/);
});
test('HTTP workflow enforces authentication, CSRF, permissions and source deletion', async () => {
  const { db } = fixture();
  const server = buildServer({ db, legacyPath: 'unused' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, cookie = '') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'erp-dashboard', Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('/api/documents')).status, 401);
    assert.equal((await fetch(base + '/api/login', { method: 'POST' })).status, 403);
    const auth = await request('/api/login', 'POST', { username: 'admin', password: 'admin-password-2026' });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    assert.match(auth.headers.get('set-cookie'), /HttpOnly/);
    const upload = await request('/api/ingest', 'POST', { title: 'Private finance', source: 'text', role: 'finance', text: 'Private payroll account confidential' }, cookie);
    assert.equal(upload.status, 201); const doc = await upload.json();
    const emp = await request('/api/login', 'POST', { username: 'employee', password: 'employee-password-2026' });
    const empCookie = emp.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await request('/api/documents', 'GET', null, empCookie)).json(), []);
    assert.deepEqual((await (await request('/api/ask', 'POST', { query: 'payroll' }, empCookie)).json()).results, []);
    assert.equal((await request('/api/audit', 'GET', null, empCookie)).status, 403);
    assert.equal((await request('/api/tasks', 'POST', { documentId: doc.id, confirm: true }, empCookie)).status, 403);
    assert.equal((await request(`/api/documents/${doc.id}`, 'DELETE', {}, empCookie)).status, 403);
    assert.equal((await request(`/api/documents/${doc.id}`, 'DELETE', {}, cookie)).status, 200);
    await request('/api/logout', 'POST', {}, cookie);
    assert.equal((await request('/api/me', 'GET', null, cookie)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
