import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const roles = ['employee', 'finance', 'admin'];
export function clean(text) {
  return String(text).normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function chunks(text, size = 1100, overlap = 180) {
  const result = [];
  for (let i = 0; i < text.length; i += size - overlap) result.push(text.slice(i, i + size));
  return result;
}
const tokens = text => clean(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const digest = value => createHash('sha256').update(value).digest('hex');
export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, role TEXT NOT NULL, fingerprint TEXT UNIQUE NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE, position INTEGER, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE, created_by INTEGER REFERENCES users(id), kind TEXT NOT NULL, status TEXT DEFAULT 'pending', created TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(document_id,kind));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT NOT NULL, target TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  return db;
}
export function addUser(db, username, role, password) {
  if (!roles.includes(role) || password.length < 12) throw new Error('Passwords must have at least 12 characters and role must be valid');
  const salt = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(username,role,salt,hash) VALUES(?,?,?,?)').run(username, role, salt, scryptSync(password, salt, 64).toString('hex'));
}
export function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const candidate = scryptSync(password, user?.salt || 'dummy-salt', 64);
  if (!user || !timingSafeEqual(candidate, Buffer.from(user.hash, 'hex'))) return null;
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + 8 * 3600000);
  audit(db, user, 'login', 'session');
  return { token, user: { id: user.id, username: user.username, role: user.role } };
}
export function session(db, token) {
  return db.prepare('SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(digest(token || ''), Date.now());
}
export function logout(db, token) { db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token || '')); }
export function audit(db, user, event, target) { db.prepare('INSERT INTO audit(user_id,event,target) VALUES(?,?,?)').run(user.id, event, String(target)); }
export function allowed(user) { return user.role === 'admin' ? roles : user.role === 'finance' ? ['employee', 'finance'] : ['employee']; }
export function visibleDocuments(db, user) {
  const acl = allowed(user);
  return db.prepare(`SELECT id,title,source,role,created FROM documents WHERE role IN (${acl.map(() => '?')}) ORDER BY id DESC`).all(...acl);
}
export function ingest(db, user, { title, source, role, text }) {
  if (user.role !== 'admin') throw new Error('Admin required');
  if (!roles.includes(role)) throw new Error('Invalid access role');
  text = clean(text);
  title = clean(title).slice(0, 200);
  if (!title || text.length < 10 || text.length > 500000) throw new Error('Provide a title and 10–500,000 characters of extractable text');
  const fingerprint = digest(`${source}\0${role}\0${title}\0${text}`);
  const existing = db.prepare('SELECT id FROM documents WHERE fingerprint=?').get(fingerprint);
  if (existing) return { id: existing.id, duplicate: true };
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare('INSERT INTO documents(title,source,role,fingerprint) VALUES(?,?,?,?)').run(title, source, role, fingerprint).lastInsertRowid);
    const insert = db.prepare('INSERT INTO chunks(document_id,position,text) VALUES(?,?,?)');
    chunks(text).forEach((part, i) => insert.run(id, i, part));
    audit(db, user, 'ingest', id);
    db.exec('COMMIT');
    return { id, duplicate: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function search(db, user, query) {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const acl = allowed(user);
  // Authorization is applied in SQL before text enters the ranking/context layer.
  const rows = db.prepare(`SELECT c.id AS chunk_id,c.text,c.position,d.id AS document_id,d.title,d.source FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.role IN (${acl.map(() => '?')})`).all(...acl);
  const corpus = rows.map(row => ({ ...row, words: tokens(row.text) }));
  const average = corpus.reduce((n, r) => n + r.words.length, 0) / (corpus.length || 1);
  const frequencies = terms.map(term => corpus.filter(r => r.words.includes(term)).length);
  return corpus.map(row => {
    const score = terms.reduce((sum, term, i) => {
      const tf = row.words.filter(word => word === term).length;
      const idf = Math.log(1 + (corpus.length - frequencies[i] + 0.5) / (frequencies[i] + 0.5));
      return sum + idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * row.words.length / average));
    }, 0);
    const { words, ...result } = row;
    return { ...result, score: Math.round(score * 1000) / 1000 };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.chunk_id - b.chunk_id).slice(0, 5);
}
export function createReview(db, user, documentId) {
  if (!['admin', 'finance'].includes(user.role)) throw new Error('Finance role required');
  const doc = visibleDocuments(db, user).find(d => d.id === documentId);
  if (!doc) throw new Error('Document unavailable');
  if (!['erp', 'pdf'].includes(doc.source)) throw new Error('Review tasks require an ERP or PDF document');
  db.prepare("INSERT OR IGNORE INTO tasks(document_id,created_by,kind) VALUES(?,?,'invoice_review')").run(documentId, user.id);
  const task = db.prepare("SELECT * FROM tasks WHERE document_id=? AND kind='invoice_review'").get(documentId);
  audit(db, user, 'request_review', task.id);
  return task;
}
export function deleteDocument(db, user, id) {
  if (user.role !== 'admin') throw new Error('Admin required');
  db.exec('BEGIN');
  try {
    const result = db.prepare('DELETE FROM documents WHERE id=?').run(id);
    audit(db, user, 'delete_document', id);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
