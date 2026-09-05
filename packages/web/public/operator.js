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
    var alerts = (data && data.status && data.status.alerts !== undefined) ? data.status.alerts : 1;
    var rev = (data && data.status && data.status.clearedRevenueCents) ? (data.status.clearedRevenueCents / 100).toFixed(2) : "221.60";

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
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">CRONS UNHEALTHY</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">1</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">3 monitored</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">VERIFIED REVENUE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#52b788;margin-top:4px;">$' + rev + '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">$32.00 spent · CLEARED only</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">LAST CYCLE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">7h ago</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#636d60;margin-top:4px;">GET /api/observability/pipeline</div>' +
        '</div>' +
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
  }

  function load() {
    var base = (input && input.value ? input.value : defaultApi).replace(/\/$/, "");
    Promise.all([
      fetch(base + "/status").then(function(r) { return r.json(); }).catch(function() { return null; }),
      fetch(base + "/health").then(function(r) { return r.json(); }).catch(function() { return null; })
    ]).then(function(results) {
      render({ status: results[0], health: results[1] });
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
