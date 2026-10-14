import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, addUser, login, session, logout, audit, visibleDocuments, ingest, search, createReview, deleteDocument, allowed } from './core.js';
import { extractPdf, slackText, seedLegacy, syncLegacy } from './connectors.js';
import { answerQuestion } from './answer.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildServer({ db, legacyPath, secureCookie = false }) {
  const failures = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { status: 'ok' });
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [file, mime] = staticFiles[url.pathname];
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
        return res.end(readFileSync(resolve(root, 'public', file)));
      }
      if (!url.pathname.startsWith('/api/')) return send(404, { error: 'Not found' });
      let body = {};
      if (['POST', 'DELETE'].includes(req.method)) {
        if (req.headers['x-requested-with'] !== 'erp-dashboard' || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'JSON request with CSRF header required' });
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Cross-origin request rejected' });
        const parts = []; let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 8 * 1024 * 1024) return send(413, { error: 'Request exceeds 8 MB' });
          parts.push(part);
        }
        try { body = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { return send(400, { error: 'Invalid JSON' }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return send(400, { error: 'Expected JSON object' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of failures) if (now - entry.time > 15 * 60000) failures.delete(key);
        const attempt = failures.get(ip) || { count: 0, time: now };
        if (attempt.count >= 10) return send(429, { error: 'Too many attempts. Try again in 15 minutes.' });
        if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 256) return send(400, { error: 'Invalid credentials format' });
        const result = login(db, body.username, body.password);
        if (!result) { attempt.count++; failures.set(ip, attempt); return send(401, { error: 'Incorrect username or password' }); }
        failures.delete(ip);
        res.setHeader('Set-Cookie', `session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? '; Secure' : ''}`);
        return send(200, result.user);
      }
      const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('session='))?.slice(8);
      const user = session(db, token);
      if (!user) return send(401, { error: 'Please sign in' });
      if (req.method === 'GET' && url.pathname === '/api/me') return send(200, user);
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        logout(db, token);
        res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/documents') return send(200, visibleDocuments(db, user));
      if (req.method === 'POST' && url.pathname === '/api/ask') {
        if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 1000) return send(400, { error: 'Query must contain 1–1,000 characters' });
        const results = search(db, user, body.query);
        audit(db, user, 'search', 'knowledge_base');
        return send(200, { ...await answerQuestion(body.query, results), results });
      }
      if (req.method === 'GET' && url.pathname === '/api/tasks') {
        const acl = allowed(user);
        return send(200, db.prepare(`SELECT t.*,d.title FROM tasks t JOIN documents d ON d.id=t.document_id WHERE d.role IN (${acl.map(() => '?')}) ORDER BY t.id DESC`).all(...acl));
      }
      if (req.method === 'POST' && url.pathname === '/api/tasks') {
        if (!['finance', 'admin'].includes(user.role)) return send(403, { error: 'Finance role required' });
        if (body.confirm !== true || !Number.isSafeInteger(body.documentId)) return send(400, { error: 'An explicit confirmation and document ID are required' });
        try { return send(200, createReview(db, user, body.documentId)); } catch (error) { return send(400, { error: error.message }); }
      }
      if (user.role !== 'admin') return send(403, { error: 'Admin role required' });
      if (req.method === 'GET' && url.pathname === '/api/audit') return send(200, db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 100').all());
      if (req.method === 'POST' && url.pathname === '/api/ingest') {
        if (typeof body.title !== 'string' || !['text', 'slack', 'pdf'].includes(body.source)) return send(400, { error: 'A title and valid source are required' });
        try {
          let text = body.text;
          if (body.source === 'slack') text = slackText(body.slack);
          if (body.source === 'pdf') {
            if (typeof body.base64 !== 'string' || body.base64.length > 7 * 1024 * 1024) throw new Error('PDF must be at most 5 MB');
            text = await extractPdf(Buffer.from(body.base64, 'base64'));
          }
          if (typeof text !== 'string') throw new Error('Text is required');
          return send(201, ingest(db, user, { title: body.title, source: body.source, role: body.role, text }));
        } catch (error) { return send(400, { error: error.message }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/sync') return send(200, { records: syncLegacy(db, user, legacyPath) });
      const match = url.pathname.match(/^\/api\/documents\/(\d+)$/);
      if (req.method === 'DELETE' && match) return send(200, { deleted: deleteDocument(db, user, Number(match[1])) });
      return send(404, { error: 'Not found' });
    } catch (error) {
      console.error('Request failed:', error.name);
      if (!res.headersSent) send(500, { error: 'The request could not be completed' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}
export function startServer() {
  const directory = resolve(process.env.DATA_DIR || resolve(root, 'data'));
  mkdirSync(directory, { recursive: true });
  const db = openStore(resolve(directory, 'app.sqlite'));
  for (const [username, role, variable] of [['admin', 'admin', 'ADMIN_PASSWORD'], ['finance', 'finance', 'FINANCE_PASSWORD'], ['employee', 'employee', 'EMPLOYEE_PASSWORD']]) {
    if (!db.prepare('SELECT id FROM users WHERE username=?').get(username)) {
      const password = process.env[variable];
      if (!password || password.length < 12) throw new Error(`Set ${variable} to a unique password with at least 12 characters`);
      addUser(db, username, role, password);
    }
  }
  const legacyPath = resolve(directory, 'legacy.sqlite');
  seedLegacy(legacyPath);
  const server = buildServer({ db, legacyPath, secureCookie: process.env.COOKIE_SECURE === 'true' });
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`Enterprise Connector ready: http://localhost:${process.env.PORT || 3000}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
