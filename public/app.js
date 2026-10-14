let user;
const $ = id => document.getElementById(id);
const notice = message => { $('notice').textContent = message; };
function confirmAction(message) {
  const dialog = $('confirm-dialog'); $('confirm-message').textContent = message; dialog.returnValue = 'cancel';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'erp-dashboard' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(data.error); }
  return data;
}
function showLogin() { user = null; $('login-panel').hidden = false; $('workspace').hidden = true; $('identity').textContent = 'Secure workspace'; $('results').replaceChildren(); $('documents').replaceChildren(); $('audit').replaceChildren(); }
async function loadWorkspace() {
  $('login-panel').hidden = true; $('workspace').hidden = false; $('admin-panel').hidden = user.role !== 'admin';
  $('identity').replaceChildren(el('span', `${user.username} · ${user.role}`));
  const out = el('button', 'Sign out', 'secondary'); out.onclick = () => run(async () => { await api('/logout', 'POST', {}); showLogin(); notice('Signed out'); }); $('identity').append(out);
  await refresh();
}
async function refresh() {
  const [documents, tasks] = await Promise.all([api('/documents'), api('/tasks')]);
  $('doc-count').textContent = documents.length; $('task-count').textContent = tasks.length;
  $('documents').replaceChildren(); $('task-list').replaceChildren();
  if (!documents.length) $('documents').append(el('p', user.role === 'admin' ? 'Add a document or sync the demo ERP to get started.' : 'No sources are available for your role yet.', 'muted'));
  for (const doc of documents) {
    const row = el('div', '', 'source-row'), label = el('div');
    label.append(el('strong', doc.title), el('small', `${doc.source.toUpperCase()} · ${doc.role} access · #${doc.id}`)); row.append(label);
    if (user.role === 'admin') { const remove = el('button', 'Delete', 'danger'); remove.onclick = () => run(async () => { if (!await confirmAction(`Delete “${doc.title}”, its search excerpts, and associated review tasks?`)) return; await api(`/documents/${doc.id}`, 'DELETE', {}); $('results').replaceChildren(); await refresh(); notice('Source and related search excerpts deleted.'); }); row.append(remove); }
    $('documents').append(row);
  }
  if (!tasks.length) $('task-list').append(el('p', 'No reviews requested yet.', 'muted'));
  for (const task of tasks) { const row = el('div', '', 'task-row'), label = el('div'); label.append(el('strong', task.title), el('small', `Review #${task.id} · ${task.created} UTC`)); row.append(label, el('span', task.status.toUpperCase(), 'pill')); $('task-list').append(row); }
}
async function run(action) { try { await action(); } catch (error) { notice(error.message); } }
$('login-form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.target); run(async () => { user = await api('/login', 'POST', Object.fromEntries(form)); event.target.reset(); notice('Signed in. Your access permissions are active.'); await loadWorkspace(); }); };
$('ask-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const data = await api('/ask', 'POST', { query: $('query').value });
    $('results').replaceChildren(el('small', data.mode === 'ollama-rag' ? 'AI answer · verify against cited evidence' : 'Local evidence · extractive mode', 'muted'), el('p', data.answer));
    if (data.warning) $('results').append(el('p', data.warning, 'muted'));
    data.results.forEach((result, index) => {
      const card = el('article', '', 'result');
      card.append(el('h3', `[${index + 1}] ${result.title}`), el('small', `${result.source.toUpperCase()} · Document #${result.document_id} · Excerpt ${result.position + 1}`), el('pre', result.text));
      if (['admin', 'finance'].includes(user.role) && ['erp', 'pdf'].includes(result.source)) {
        const action = el('button', 'Request invoice review', 'secondary');
        action.onclick = () => run(async () => { if (!await confirmAction(`Create an invoice review task for “${result.title}”? No payment will be made.`)) return; const task = await api('/tasks', 'POST', { documentId: result.document_id, confirm: true }); notice(`Review #${task.id} is pending. Repeated requests reuse the same task.`); await refresh(); }); card.append(action);
      }
      $('results').append(card);
    });
  } finally { button.disabled = false; }
}); };
document.querySelectorAll('[data-query]').forEach(button => { button.onclick = () => { $('query').value = button.dataset.query; $('ask-form').requestSubmit(); }; });
$('sync').onclick = () => run(async () => { const data = await api('/sync', 'POST', {}); await refresh(); notice(`${data.records.length} ERP records checked; ${data.records.filter(r => !r.duplicate).length} new sources added.`); });
$('ingest-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const file = $('source-file').files[0];
    if (file && file.size > 5 * 1024 * 1024) throw new Error('File limit is 5 MB');
    if (body.source === 'pdf') {
      if (!file) throw new Error('Select a PDF file');
      body.base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    } else if (body.source === 'slack') { body.slack = JSON.parse(file ? await file.text() : body.text); }
    else if (file) body.text = await file.text();
    const result = await api('/ingest', 'POST', body); await refresh(); event.target.reset(); notice(result.duplicate ? 'This source is already indexed.' : 'Source cleaned, split into excerpts, and indexed.');
  } finally { button.disabled = false; }
}); };
$('audit-button').onclick = () => run(async () => { const rows = await api('/audit'); $('audit').replaceChildren(...rows.map(row => el('div', `${row.created} UTC · ${row.username || row.user_id} · ${row.event} · ${row.target}`, 'audit-row'))); });
run(async () => { try { user = await api('/me'); await loadWorkspace(); } catch { showLogin(); } });
