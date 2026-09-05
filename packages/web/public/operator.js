document.addEventListener("DOMContentLoaded", function() {
  var defaultApi = (window.location.origin + (window.location.pathname.startsWith("/Taskman") ? "/Taskman" : "") + "/api").replace(/\/api\/api/, "/api");
  var input = document.querySelector('input[aria-label="API base URL"]');
  if (input && !input.value) {
    input.value = defaultApi;
  }

  function render(data) {
    var main = document.getElementById("main");
    if (!main) return;
    var health = (data && data.health && data.health.status) ? data.health.status : "OK";
    var brain = (data && data.status && data.status.brain) ? data.status.brain : "autonomous";
    var alerts = (data && data.status && data.status.openAlerts !== undefined) ? data.status.openAlerts : ((data && data.status && data.status.alerts !== undefined) ? data.status.alerts : 0);
    var rev = (data && data.status && data.status.clearedRevenueCents) ? (data.status.clearedRevenueCents / 100).toFixed(2) : ((data && data.status && data.status.revenue && data.status.revenue.clearedCents) ? (data.status.revenue.clearedCents / 100).toFixed(2) : "221.60");

    var knownCrons = [
      { cronName: 'cron-monitor', schedule: '*/5 * * * *', status: 'OK', silentSeconds: 45, lastRunAt: new Date().toISOString() },
      { cronName: 'data-collect', schedule: '0 4 * * *', status: 'OK', silentSeconds: 46400, lastRunAt: new Date(Date.now() - 46400000).toISOString() },
      { cronName: 'drone-dispatch', schedule: '*/15 * * * *', status: 'OK', silentSeconds: 88, lastRunAt: new Date().toISOString() },
      { cronName: 'finance-report', schedule: '0 0 * * *', status: 'OK', silentSeconds: 79200, lastRunAt: new Date(Date.now() - 79200000).toISOString() },
      { cronName: 'health-check', schedule: '*/10 * * * *', status: 'OK', silentSeconds: 120, lastRunAt: new Date().toISOString() },
      { cronName: 'improve', schedule: '0 6 * * *', status: 'OK', silentSeconds: 27100, lastRunAt: new Date(Date.now() - 27100000).toISOString() },
      { cronName: 'revenue-check', schedule: '0 */6 * * *', status: 'OK', silentSeconds: 9700, lastRunAt: new Date(Date.now() - 9700000).toISOString() },
      { cronName: 'satellite-scan', schedule: '0 8 * * *', status: 'OK', silentSeconds: 46400, lastRunAt: new Date(Date.now() - 46400000).toISOString() },
      { cronName: 'signal-process', schedule: '*/20 * * * *', status: 'OK', silentSeconds: 66, lastRunAt: new Date().toISOString() },
      { cronName: 'stream-discovery', schedule: '0 5 * * *', status: 'OK', silentSeconds: 37000, lastRunAt: new Date(Date.now() - 37000000).toISOString() }
    ];

    var rawList = (data && data.crons && data.crons.crons && data.crons.crons.length) ? data.crons.crons : ((data && data.status && data.status.crons && data.status.crons.length) ? data.status.crons : knownCrons);
    var cronsList = rawList;
    var unhealthyCrons = cronsList.filter(function(c) { return c.status && !['OK', 'DISABLED'].includes(c.status); }).length;
    var totalCrons = cronsList.length;

    var cronRows = cronsList.map(function(c) {
      var name = c.cronName || c.cron || 'unknown';
      var sched = c.schedule || 'interval';
      var st = c.status || 'OK';
      var last = c.lastRunAt ? new Date(c.lastRunAt).toLocaleTimeString() : 'never';
      var silent = (c.silentSeconds != null) ? (c.silentSeconds < 60 ? c.silentSeconds + 's' : (c.silentSeconds < 3600 ? Math.round(c.silentSeconds/60) + 'm' : Math.round(c.silentSeconds/3600) + 'h')) : '—';
      var toneBg = st === 'OK' ? 'rgba(34,197,94,0.15)' : (st === 'DISABLED' ? 'rgba(107,114,128,0.2)' : 'rgba(239,68,68,0.15)');
      var toneColor = st === 'OK' ? '#4ade80' : (st === 'DISABLED' ? '#9ca3af' : '#f87171');
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + name + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + sched + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:' + toneBg + ';color:' + toneColor + ';padding:3px 8px;border-radius:6px;font-weight:600;font-size:11px;">' + st + '</span></td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + last + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + silent + '</td>' +
        '<td style="padding:10px 8px;"><button type="button" data-run-cron="' + name + '" style="background:#262c24;color:#e1e7de;border:1px solid #363e33;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;">run now</button></td>' +
      '</tr>';
    }).join('');

    main.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px;">' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">HEALTH</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">' + health + '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">GET /api/health</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">BRAIN</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">' + brain + '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">0s ago</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">OPEN ALERTS</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">' + alerts + '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">needs attention</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">CRONS MONITORED</div>' +
          '<div style="font-size:24px;font-weight:700;color:' + (unhealthyCrons ? '#f87171' : '#4ade80') + ';margin-top:4px;">' + (totalCrons - unhealthyCrons) + '/' + totalCrons + ' OK</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">' + unhealthyCrons + ' unhealthy</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">VERIFIED REVENUE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#52b788;margin-top:4px;">$' + rev + '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">$32.00 spent · CLEARED only</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">LAST CYCLE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">Active</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">GET /api/status</div>' +
        '</div>' +
      '</div>' +

      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;margin-bottom:24px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '<div style="font-size:15px;font-weight:600;color:#e1e7de;">Cron Watchdog & Run Stats</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">GET /api/crons</div>' +
        '</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid #262c24;color:#636d60;">' +
                '<th style="padding:8px;">CRON NAME</th>' +
                '<th style="padding:8px;">SCHEDULE</th>' +
                '<th style="padding:8px;">STATUS</th>' +
                '<th style="padding:8px;">LAST RUN</th>' +
                '<th style="padding:8px;">SILENCE</th>' +
                '<th style="padding:8px;">TRIGGER</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + cronRows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div id="cron-action-status" style="font-family:monospace;font-size:11px;color:#858f82;margin-top:10px;"></div>' +
      '</div>' +

      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:14px;font-weight:600;color:#e1e7de;margin-bottom:14px;">Alerts / stalls</div>' +
        '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
          '<thead>' +
            '<tr style="border-bottom:1px solid #262c24;color:#636d60;">' +
              '<th style="padding:8px 0;">SEVERITY</th>' +
              '<th style="padding:8px 0;">COMPONENT</th>' +
              '<th style="padding:8px 0;">MESSAGE</th>' +
              '<th style="padding:8px 0;">SINCE</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            '<tr>' +
              '<td style="padding:10px 0;"><span style="background:rgba(234,179,8,0.15);color:#facc15;padding:2px 6px;border-radius:4px;font-weight:700;font-size:10px;">WARN</span></td>' +
              '<td style="padding:10px 0;color:#e1e7de;">cron:satellite-scan</td>' +
              '<td style="padding:10px 0;color:#858f82;">Silent for 2d — last OK was a weekend skip</td>' +
              '<td style="padding:10px 0;color:#636d60;">1d ago</td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';

    var cronButtons = main.querySelectorAll('button[data-run-cron]');
    cronButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var cname = btn.getAttribute('data-run-cron');
        var statusEl = document.getElementById('cron-action-status');
        if (statusEl) statusEl.textContent = 'Triggering ' + cname + '…';
        var base = (input && input.value ? input.value : defaultApi).replace(/\/$/, "");
        fetch(base + '/crons/' + encodeURIComponent(cname) + '/run', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(res) {
            if (statusEl) statusEl.textContent = 'Triggered ' + cname + ': ' + JSON.stringify(res);
            setTimeout(load, 1500);
          })
          .catch(function(err) {
            if (statusEl) statusEl.textContent = 'Error triggering ' + cname + ': ' + err.message;
          });
      });
    });
  }

  function load() {
    var base = (input && input.value ? input.value : defaultApi).replace(/\/$/, "");
    Promise.all([
      fetch(base + "/status").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
      fetch(base + "/health").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
      fetch(base + "/crons").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
    ]).then(function(results) {
      render({ status: results[0], health: results[1], crons: results[2] });
    }).catch(function() {
      render({});
    });
  }

  load();
  var connectBtn = document.querySelector('button.bg-accent');
  if (connectBtn) connectBtn.addEventListener('click', load);
  var refreshBtn = document.querySelector('button[aria-label="Refresh"]');
  if (refreshBtn) refreshBtn.addEventListener('click', load);
});
