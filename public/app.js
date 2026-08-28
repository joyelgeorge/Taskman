const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, options) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

async function refresh() {
  const [status, tasks, runs] = await Promise.all([api('/api/status'), api('/api/tasks'), api('/api/runs')]);
  $('#providers').innerHTML = status.providers.map(p => `<span class="pill">${esc(p.id)} · ${p.ready ? 'ready' : 'no key'}</span>`).join('');
  $('#usage').textContent = `${status.usage.inputTokens + status.usage.outputTokens} tokens tracked`;

  $('#tasks').innerHTML = tasks.length ? tasks.map(t => `
    <div class="task">
      <div class="row"><strong>${esc(t.title)}</strong><span class="pill">${esc(t.status)}</span>${t.intervalMinutes ? `<span class="pill">every ${t.intervalMinutes}m</span>` : '<span class="pill">manual</span>'}</div>
      <div class="muted">${esc(t.prompt)}</div>
      <div class="row" style="margin-top:10px">
        <button data-run="${t.id}">Run now</button>
        <button data-pause="${t.id}">${t.status === 'active' ? 'Pause' : 'Resume'}</button>
      </div>
      ${t.lastResult ? `<div class="result">${esc(t.lastResult)}</div>` : ''}
    </div>`).join('') : '<p class="muted">No tasks yet.</p>';

  $('#runs').innerHTML = runs.length ? runs.slice(0, 10).map(r => `
    <div class="task">
      <div class="row"><strong>${esc(r.status)}</strong>${r.provider ? `<span class="pill">${esc(r.provider)}</span>` : ''}<span class="muted">${new Date(r.startedAt).toLocaleString()}</span></div>
      ${r.result ? `<div class="result">${esc(r.result)}</div>` : ''}
      ${r.error ? `<div class="result">${esc(r.error)}</div>` : ''}
      ${r.nextBestAction ? `<p class="muted"><strong>Next:</strong> ${esc(r.nextBestAction)}</p>` : ''}
    </div>`).join('') : '<p class="muted">No runs yet.</p>';
}

$('#create').onclick = async () => {
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: $('#title').value, prompt: $('#prompt').value, intervalMinutes: $('#interval').value }) });
    $('#title').value = ''; $('#prompt').value = ''; $('#interval').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
};

document.addEventListener('click', async e => {
  const run = e.target.closest('[data-run]');
  const pause = e.target.closest('[data-pause]');
  try {
    if (run) await api(`/api/tasks/${run.dataset.run}/run`, { method: 'POST' });
    if (pause) await api(`/api/tasks/${pause.dataset.pause}/pause`, { method: 'POST' });
    if (run || pause) await refresh();
  } catch (err) { alert(err.message); }
});

refresh();
setInterval(refresh, 5000);
