async function renderAutonomy() {
  const [crons, drones, signals, scans] = await Promise.all([
    tryApi('/api/crons'), tryApi('/api/drones'), tryApi('/api/signals?limit=25'), tryApi('/api/scans')
  ]);
  if (!crons.ok && !drones.ok) throw crons.error || drones.error;
  return viewShell('Autonomy', 'Drones, crons, last OK / fail, silent periods. Mutations need the bearer token.',
    `<div class="tiles">${tile('Drones', drones.data ? `${drones.data.drones?.filter((d) => d.enabled).length || 0}/${drones.data.drones?.length || 0}` : '—', 'enabled / total')}${tile('Crons', crons.data?.crons?.length ?? '—', 'registered')}${tile('Signals', signals.data?.stats?.total ?? '—', `${signals.data?.stats?.byStatus?.NEW || 0} awaiting`)}</div>
     <div class="sec-head"><h2>Crons</h2></div>
     <div class="card"><table><thead><tr><th>Cron</th><th>Schedule</th><th>Status</th><th>Last run</th><th class="n">Silent</th><th></th></tr></thead>
     <tbody>${rows(crons.data?.crons, (c) => `<tr><td class="k">${esc(c.cronName)}</td><td class="k">${esc(c.schedule)}</td><td>${pill(CRON_TONE[c.status] || 'warn', c.status)}</td><td>${esc(ago(c.lastRunAt))}</td><td class="n">${esc(duration(c.silentSeconds))}</td><td><button class="mini" data-cron="${esc(c.cronName)}">run now</button></td></tr>`, crons.ok ? 'No crons registered.' : crons.error.message, 6)}</tbody></table></div>
     <div class="sec-head"><h2>Drones</h2></div>
     <div class="card"><table><thead><tr><th>Drone</th><th>Kind</th><th>Status</th><th>Last OK</th><th class="n">Fails</th><th></th></tr></thead>
     <tbody>${rows(drones.data?.drones, (d) => {
       const quarantined = d.quarantinedUntil && new Date(d.quarantinedUntil) > new Date();
       const tone = !d.enabled ? 'off' : quarantined ? 'bad' : d.consecutiveFailures ? 'warn' : 'ok';
       const label = !d.enabled ? 'DISABLED' : quarantined ? 'QUARANTINED' : d.consecutiveFailures ? 'DEGRADED' : 'OK';
       return `<tr class="${d.enabled ? '' : 'dim'}"><td class="k">${esc(d.id)}</td><td class="k">${esc(d.kind)}</td><td>${pill(tone, label)}</td><td>${esc(ago(d.lastOkAt))}</td><td class="n">${esc(d.consecutiveFailures)}</td><td><div class="row-actions"><button class="mini" data-drone-run="${esc(d.id)}">fly</button><button class="mini" data-drone-toggle="${esc(d.id)}" data-enabled="${d.enabled}">${d.enabled ? 'disable' : 'enable'}</button></div></td></tr>`;
     }, drones.ok ? 'No drones registered.' : drones.error.message, 6)}</tbody></table></div>
     <div class="sec-head"><h2>Recent signals</h2></div>
     <div class="card"><table><thead><tr><th>Drone</th><th>Title</th><th>Status</th><th class="n">Score</th></tr></thead>
     <tbody>${rows(signals.data?.signals, (s) => `<tr><td class="k">${esc(s.droneId)}</td><td class="wrap-any">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : esc(s.title || '—')}</td><td>${pill(s.status === 'PROCESSED' ? 'ok' : s.status === 'QUARANTINED' ? 'bad' : 'warn', s.status)}</td><td class="n">${s.score == null ? '—' : Number(s.score).toFixed(2)}</td></tr>`, signals.ok ? 'No signals yet.' : 'GET /api/signals not on this origin.', 4)}</tbody></table></div>
     <div class="sec-head"><h2>Satellite scans</h2><button id="scan-run" class="mini" type="button">scan now</button></div>
     <div class="card"><table><thead><tr><th>Target</th><th>Reachable</th><th>Bot defense</th><th>Shape</th><th>Verdict</th><th>Last scan</th></tr></thead>
     <tbody>${rows(scans.data?.scans, (s) => `<tr><td class="k">${esc(s.targetKey)}</td><td>${pill(s.reachable ? 'ok' : 'bad', s.reachable ? 'yes' : 'no')}</td><td>${pill(s.botDefended ? 'bad' : 'ok', s.botDefended ? (s.botDefenseVendor || 'yes') : 'no')}</td><td class="k">${esc(s.shape)}</td><td class="wrap-any">${esc(s.verdict)}</td><td>${esc(ago(s.scannedAt))}</td></tr>`, scans.ok ? 'No scans yet.' : 'GET /api/scans not on this origin.', 6)}</tbody></table></div>`);
}

async function renderWork() {
  const [tasks, runs, scenarios, brain, improvements] = await Promise.all([
    tryApi('/api/tasks'), tryApi('/api/runs'), tryApi('/api/scenarios'), tryApi('/api/brain'), tryApi('/api/improvements')
  ]);
  const taskList = Array.isArray(tasks.data) ? tasks.data : tasks.data?.tasks || [];
  const runList = Array.isArray(runs.data) ? runs.data : runs.data?.runs || [];
  const scenarioList = Array.isArray(scenarios.data) ? scenarios.data : scenarios.data?.scenarios || [];
  return viewShell('Work', 'Tasks/runs/brain live on src/server.js. Improvements live on packages/api. A 404 means this base is the other process.',
    `<div class="card pad"><h2 style="margin-top:0">Create task</h2><p class="lede">POST /api/tasks requires prompt.</p><div class="form-grid"><input id="task-title" placeholder="Title"><input id="task-interval" placeholder="Interval minutes"><input id="task-prompt" placeholder="Prompt (required)"><button id="task-add" class="primary" type="button">Enqueue task</button></div>${tasks.missing ? '<div class="state">GET /api/tasks is not on this origin.</div>' : ''}</div>
     <div class="sec-head"><h2>Brain</h2>${brain.ok ? '<button class="mini" data-brain-run="1" type="button">run cycle</button>' : ''}</div>
     ${brain.ok ? `<div class="card pad"><pre style="white-space:pre-wrap;font-family:var(--mono);font-size:12px;color:var(--muted)">${esc(JSON.stringify(brain.data, null, 2).slice(0, 2000))}</pre></div>` : `<div class="state">${esc(brain.missing ? 'GET /api/brain lives on src/server.js.' : brain.error?.message || 'unreachable')}</div>`}
     <div class="sec-head"><h2>Tasks</h2></div><div class="card"><table><thead><tr><th>Title</th><th>Status</th><th>Interval</th><th>Id</th></tr></thead><tbody>${rows(taskList, (t) => `<tr><td>${esc(t.title || t.prompt || '—')}</td><td>${pill(t.status === 'active' ? 'ok' : 'off', t.status || '—')}</td><td class="n">${esc(t.intervalMinutes ?? '—')}</td><td class="k">${esc(t.id)}</td></tr>`, tasks.ok ? 'No tasks.' : (tasks.missing ? 'Not on this origin.' : tasks.error.message), 4)}</tbody></table></div>
     <div class="sec-head"><h2>Recent runs</h2></div><div class="card"><table><thead><tr><th>Status</th><th>Task</th><th>Reason</th><th>Finished</th></tr></thead><tbody>${rows(runList, (r) => `<tr><td>${pill(r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn', r.status)}</td><td class="k">${esc(r.taskId)}</td><td>${esc(r.reason || '—')}</td><td>${esc(ago(r.finishedAt || r.startedAt))}</td></tr>`, runs.ok ? 'No runs.' : (runs.missing ? 'GET /api/runs not on this origin.' : runs.error.message), 4)}</tbody></table></div>
     <div class="sec-head"><h2>Scenarios</h2></div><div class="card"><table><thead><tr><th>Name</th><th>Id</th></tr></thead><tbody>${rows(scenarioList, (s) => `<tr><td>${esc(s.title || s.name || '—')}</td><td class="k">${esc(s.id)}</td></tr>`, scenarios.ok ? 'No scenarios.' : (scenarios.missing ? 'GET /api/scenarios not on this origin.' : scenarios.error.message), 2)}</tbody></table></div>
     <div class="sec-head"><h2>Improvement proposals</h2></div><div class="card"><table><thead><tr><th class="n">Score</th><th>Source</th><th>Proposal</th><th></th></tr></thead><tbody>${rows(improvements.data?.improvements, (i) => `<tr><td class="n">${Number(i.score).toFixed(2)}</td><td class="k">${esc(i.source)}</td><td class="wrap-any"><strong>${esc(i.title)}</strong><br><span style="color:var(--muted)">${esc(i.proposedChange)}</span></td><td><div class="row-actions"><button class="mini" data-improve="${esc(i.id)}" data-decision="ACCEPTED">accept</button><button class="mini" data-improve="${esc(i.id)}" data-decision="REJECTED">reject</button></div></td></tr>`, improvements.ok ? 'No open proposals.' : 'GET /api/improvements not on this origin.', 4)}</tbody></table></div>`);
}

function renderGrowth() {
  return viewShell('Growth / scaffold', 'No /api/leads or /api/campaigns on this branch. Finance is live on Ledger.',
    `<div class="tiles">${tile('Leads', 'not wired', 'no GET /api/leads')}${tile('Campaigns', 'not wired', 'no GET /api/campaigns')}${tile('Finance wing', 'live on Ledger', 'GET /api/finance/report')}</div>
     <div class="state todo"><strong>#129–#135</strong><div>Leads, campaigns, outbound, catalog, attribution, finance-wing bindings, growth↔ledger hook. Empty until those routes exist.</div></div>`);
}
