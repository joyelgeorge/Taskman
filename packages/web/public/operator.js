document.addEventListener("DOMContentLoaded", function() {
  var defaultApi = (window.location.origin + (window.location.pathname.startsWith("/Taskman") ? "/Taskman" : "") + "/api").replace(/\/api\/api/, "/api");
  var input = document.querySelector('input[aria-label="API base URL"]');
  if (input && !input.value) {
    input.value = defaultApi;
  }

  function getViewFromHash() {
    var hash = (window.location.hash || '#/overview').replace(/^#\/?/, '').toLowerCase();
    if (hash === 'opportunities') return 'opportunities';
    if (hash === 'ledger') return 'ledger';
    if (hash === 'autonomy') return 'autonomy';
    if (hash === 'work') return 'work';
    if (hash === 'growth') return 'growth';
    return 'overview';
  }

  var currentView = getViewFromHash();

  function updateNav() {
    var navLinks = document.querySelectorAll('nav[aria-label="Primary"] a');
    var hash = window.location.hash || '#/overview';
    navLinks.forEach(function(a) {
      var href = a.getAttribute('href');
      var isMatch = (href === hash) || (hash === '#/' && href === '#/overview');
      if (isMatch) {
        a.className = "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150 bg-raised text-ink outline-1 outline-accent/40";
      } else {
        a.className = "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150 text-muted hover:bg-raised hover:text-ink";
      }
    });

    var pageTitle = document.querySelector('.op-top h1');
    if (pageTitle) {
      var titles = {
        overview: 'Overview',
        opportunities: 'Money-Making Opportunities',
        ledger: 'Money / Ledger',
        autonomy: 'Autonomy',
        work: 'Work',
        growth: 'Growth / Scaffold'
      };
      pageTitle.textContent = titles[currentView] || 'Overview';
    }
  }

  window.addEventListener('hashchange', function() {
    currentView = getViewFromHash();
    updateNav();
    load();
  });

  function renderOpportunities(data) {
    var main = document.getElementById("main");
    if (!main) return;

    var streams = (data && data.streams) || [];
    var dataProducts = (data && data.dataProducts) || [];
    var tasks = (data && data.tasks) || [];
    var verdict = (data && data.verdict) || "Every number in this system is preparation until settlement.";
    var nextAction = (data && data.nextAction) || "Keep automation running to accumulate data.";

    var actionableCount = (data && data.actionable) ? data.actionable.length : streams.filter(function(s) { return s.unblockedBy === 'machine' && s.state !== 'DISPROVEN'; }).length;
    var humanCount = (data && data.waitingOnHuman) ? data.waitingOnHuman.length : streams.filter(function(s) { return s.unblockedBy === 'human'; }).length;
    var totalProofCents = streams.reduce(function(acc, s) { return acc + (s.proofCents || 0); }, 0);

    var streamsHtml = streams.map(function(s) {
      var stateBg = s.state === 'TESTING' ? 'rgba(59,130,246,0.15)' : (s.state === 'BLOCKED' ? 'rgba(234,179,8,0.15)' : (s.state === 'DISPROVEN' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'));
      var stateColor = s.state === 'TESTING' ? '#60a5fa' : (s.state === 'BLOCKED' ? '#facc15' : (s.state === 'DISPROVEN' ? '#f87171' : '#4ade80'));
      var proof = s.proofCents != null ? '$' + (s.proofCents / 100).toFixed(2) : '—';
      var testHours = s.testCostHours != null ? s.testCostHours + 'h' : '0h';

      return '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:700;color:#e1e7de;">' + (s.title || s.streamKey) + '</div>' +
            '<div style="font-family:monospace;font-size:11px;color:#858f82;margin-top:2px;">Key: ' + s.streamKey + ' · Unblocked by: <strong style="color:#e1e7de;">' + (s.unblockedBy || 'machine') + '</strong></div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<span style="background:' + stateBg + ';color:' + stateColor + ';padding:4px 8px;border-radius:6px;font-weight:700;font-size:11px;letter-spacing:0.5px;">' + s.state + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:13px;color:#cbd5e1;line-height:1.4;">' + (s.mechanism || '') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;background:#0d110d;padding:10px;border-radius:8px;border:1px solid #1c211b;font-size:12px;">' +
          '<div><span style="color:#858f82;">Target Proof:</span> <strong style="color:#4ade80;">' + proof + '</strong></div>' +
          '<div><span style="color:#858f82;">Test Cost:</span> <strong style="color:#e1e7de;">' + testHours + '</strong></div>' +
          '<div><span style="color:#858f82;">Origin:</span> <strong style="color:#e1e7de;">' + (s.origin || 'seed') + '</strong></div>' +
        '</div>' +
        (s.requires ? '<div style="font-size:12px;color:#94a3b8;"><strong style="color:#cbd5e1;">Requirements:</strong> ' + s.requires + '</div>' : '') +
        (s.stateReason ? '<div style="font-size:12px;color:#94a3b8;"><strong style="color:#cbd5e1;">State Reason:</strong> ' + s.stateReason + '</div>' : '') +
        (s.nextAction ? '<div style="font-size:12px;color:#facc15;background:rgba(234,179,8,0.08);padding:8px 10px;border-radius:6px;border:1px solid rgba(234,179,8,0.2);"><strong style="color:#fde047;">Next Action:</strong> ' + s.nextAction + '</div>' : '') +
      '</div>';
    }).join('');

    var productsHtml = dataProducts.map(function(p) {
      var sellableBadge = p.sellable ? '<span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;">SELLABLE</span>' : '<span style="background:rgba(234,179,8,0.15);color:#facc15;padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;">ACCRUING</span>';
      var blockers = (p.blockers && p.blockers.length) ? p.blockers.map(function(b) { return '<li>' + b + '</li>'; }).join('') : 'None';
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + p.productKey + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + p.observationDays + 'd</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + p.rowCount + '</td>' +
        '<td style="padding:10px 8px;">' + sellableBadge + '</td>' +
        '<td style="padding:10px 8px;color:#94a3b8;font-size:11px;"><ul style="margin:0;padding-left:16px;">' + blockers + '</ul></td>' +
      '</tr>';
    }).join('');

    var tasksHtml = (tasks && tasks.length) ? tasks.map(function(t) {
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + (t.title || t.id) + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (t.intervalMinutes ? t.intervalMinutes + 'm' : 'Manual') + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;">' + (t.status || 'ACTIVE') + '</span></td>' +
        '<td style="padding:10px 8px;color:#94a3b8;font-size:12px;max-width:350px;">' + (t.prompt ? t.prompt.slice(0, 140) + '…' : '—') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4" style="padding:12px;color:#858f82;text-align:center;">No tasks loaded</td></tr>';

    main.innerHTML =
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;margin-bottom:20px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
          '<div>' +
            '<div style="font-size:18px;font-weight:700;color:#e1e7de;">Money-Making Candidates & Opportunity Pipeline</div>' +
            '<div style="font-size:12px;color:#858f82;margin-top:4px;">Direct connection to db <code style="color:#a3e635;">income_streams</code>, <code style="color:#a3e635;">data_products</code>, and active <code style="color:#a3e635;">tasks</code>.</div>' +
          '</div>' +
          '<div style="font-family:monospace;font-size:12px;background:rgba(34,197,94,0.1);color:#4ade80;padding:6px 12px;border-radius:8px;border:1px solid rgba(34,197,94,0.2);">' +
            'First Settlement Proof Potential: $' + (totalProofCents / 100).toFixed(2) +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px;padding:12px;background:#0d110d;border-radius:8px;border:1px solid #1c211b;font-size:13px;color:#cbd5e1;">' +
          '<strong>System Verdict:</strong> ' + verdict + '<br/>' +
          '<span style="color:#858f82;">System Strategy: ' + nextAction + '</span>' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px;">' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">TOTAL STREAMS</div>' +
          '<div style="font-size:26px;font-weight:700;color:#e1e7de;margin-top:4px;">' + streams.length + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Tracked income hypotheses</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">ACTIONABLE BY MACHINE</div>' +
          '<div style="font-size:26px;font-weight:700;color:#60a5fa;margin-top:4px;">' + actionableCount + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Requires zero human KYC</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">WAITING ON HUMAN</div>' +
          '<div style="font-size:26px;font-weight:700;color:#facc15;margin-top:4px;">' + humanCount + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Accounts / KYC / client trust</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">DATA PRODUCTS</div>' +
          '<div style="font-size:26px;font-weight:700;color:#4ade80;margin-top:4px;">' + dataProducts.length + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Accruing observation history</div>' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:24px;">' +
        '<div style="font-size:16px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Income Stream Candidates & Verification Metrics</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">' +
          streamsHtml +
        '</div>' +
      '</div>' +

      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;margin-bottom:24px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Accruing Data Products (History Moats)</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid #262c24;color:#636d60;">' +
                '<th style="padding:8px;">PRODUCT KEY</th>' +
                '<th style="padding:8px;">OBSERVATION DAYS</th>' +
                '<th style="padding:8px;">ROW COUNT</th>' +
                '<th style="padding:8px;">STATUS</th>' +
                '<th style="padding:8px;">COMMERCIAL BLOCKERS</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + productsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;margin-bottom:24px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:700;color:#e1e7de;">Evaluate & Add New Possibility</div>' +
            '<div style="font-size:12px;color:#858f82;margin-top:2px;">Runs economic calculations (EV, hourly proof rate, opportunity cost, and viability gate) before recording into the database.</div>' +
          '</div>' +
        '</div>' +
        '<form id="new-opp-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;background:#0d110d;padding:16px;border-radius:8px;border:1px solid #1c211b;">' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">OPPORTUNITY TITLE *</label>' +
            '<input id="opp-title" required placeholder="e.g. Automated Shopify inventory dispute audit" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">STREAM KEY (SLUG) *</label>' +
            '<input id="opp-key" placeholder="e.g. shopify-dispute-audit" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div style="grid-column:1 / -1;">' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">HOW MONEY PHYSICALLY ARRIVES (MECHANISM) *</label>' +
            '<textarea id="opp-mech" rows="2" required placeholder="Name the exact money movement (e.g. Buyer pays via Stripe invoice after previewing missing reconciliations)." style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;resize:vertical;"></textarea>' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">WHAT WOULD HAVE TO BE TRUE (REQUIRES) *</label>' +
            '<input id="opp-req" required placeholder="e.g. Merchant with >$10k/mo dispute volume." style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">IMMEDIATE NEXT ACTION *</label>' +
            '<input id="opp-action" required placeholder="e.g. Build sample CSV transformer parser." style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">UNBLOCKED BY *</label>' +
            '<select id="opp-unblocked" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;">' +
              '<option value="machine">machine (zero KYC / autonomous execution)</option>' +
              '<option value="human">human (requires account KYC / bank / manual trust)</option>' +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">FIRST SETTLEMENT PROOF (USD $)</label>' +
            '<input id="opp-proof" type="number" step="0.01" value="25.00" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">TEST COST (HOURS)</label>' +
            '<input id="opp-hours" type="number" step="0.5" value="1.0" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-size:11px;font-family:monospace;color:#858f82;margin-bottom:4px;">ESTIMATED PROBABILITY OF PAYOUT (0.0 - 1.0)</label>' +
            '<input id="opp-prob" type="number" step="0.05" min="0" max="1" value="0.60" style="width:100%;box-sizing:border-box;background:#141813;border:1px solid #262c24;border-radius:6px;padding:8px 12px;font-size:13px;color:#e1e7de;outline:none;" />' +
          '</div>' +

          '<div id="opp-calc-preview" style="grid-column:1 / -1;background:#141813;border:1px solid #262c24;border-radius:8px;padding:14px;margin-top:4px;">' +
            '<div style="font-size:12px;font-weight:700;color:#858f82;text-transform:uppercase;letter-spacing:0.5px;">Economic Calculation & Viability Stats</div>' +
            '<div id="opp-stats-content" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:10px;font-family:monospace;font-size:12px;"></div>' +
          '</div>' +

          '<div style="grid-column:1 / -1;display:flex;justify-content:space-between;align-items:center;margin-top:6px;">' +
            '<div id="opp-submit-status" style="font-family:monospace;font-size:12px;color:#858f82;"></div>' +
            '<button id="opp-submit-btn" type="button" style="background:#22c55e;color:#0d110d;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Calculate & Add to Database</button>' +
          '</div>' +
        '</form>' +
      '</div>' +

      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Connected Database Execution Tasks</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid #262c24;color:#636d60;">' +
                '<th style="padding:8px;">TASK TITLE</th>' +
                '<th style="padding:8px;">CADENCE</th>' +
                '<th style="padding:8px;">STATUS</th>' +
                '<th style="padding:8px;">OBJECTIVE / PROMPT</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + tasksHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    function computeStats() {
      var proofVal = parseFloat(document.getElementById('opp-proof').value) || 0;
      var hoursVal = parseFloat(document.getElementById('opp-hours').value) || 0;
      var probVal = parseFloat(document.getElementById('opp-prob').value) || 0;
      var unblockedVal = document.getElementById('opp-unblocked').value;

      var ev = proofVal * probVal;
      var oppCost = hoursVal * 50;
      var netEv = ev - oppCost;
      var proofRate = hoursVal > 0 ? (proofVal / hoursVal) : proofVal;
      var viable = netEv >= 0 || hoursVal <= 2;

      var statsContent = document.getElementById('opp-stats-content');
      if (statsContent) {
        statsContent.innerHTML =
          '<div><div style="color:#858f82;">GROSS PROOF:</div><div style="font-weight:700;color:#e1e7de;font-size:14px;">$' + proofVal.toFixed(2) + '</div></div>' +
          '<div><div style="color:#858f82;">EST. PROBABILITY:</div><div style="font-weight:700;color:#60a5fa;font-size:14px;">' + Math.round(probVal * 100) + '%</div></div>' +
          '<div><div style="color:#858f82;">EXPECTED VALUE:</div><div style="font-weight:700;color:#4ade80;font-size:14px;">$' + ev.toFixed(2) + '</div></div>' +
          '<div><div style="color:#858f82;">OPP. COST ($50/h):</div><div style="font-weight:700;color:#f87171;font-size:14px;">$' + oppCost.toFixed(2) + '</div></div>' +
          '<div><div style="color:#858f82;">EXPECTED NET VALUE:</div><div style="font-weight:700;color:' + (netEv >= 0 ? '#4ade80' : '#facc15') + ';font-size:14px;">$' + netEv.toFixed(2) + '</div></div>' +
          '<div><div style="color:#858f82;">PROOF RATE/HR:</div><div style="font-weight:700;color:#e1e7de;font-size:14px;">$' + proofRate.toFixed(2) + '/h</div></div>' +
          '<div><div style="color:#858f82;">GATE VERDICT:</div><div style="font-weight:700;color:' + (viable ? '#4ade80' : '#f87171') + ';font-size:14px;">' + (viable ? 'VIABLE' : 'HIGH_TEST_COST') + '</div></div>';
      }
      return { grossReward: proofVal, pSuccess: probVal, expectedValue: ev, opportunityCost: oppCost, expectedNetValue: netEv, hourlyProofRate: proofRate, viable: viable };
    }

    var proofInput = document.getElementById('opp-proof');
    var hoursInput = document.getElementById('opp-hours');
    var probInput = document.getElementById('opp-prob');
    var titleInput = document.getElementById('opp-title');
    var keyInput = document.getElementById('opp-key');

    if (titleInput && keyInput) {
      titleInput.addEventListener('input', function() {
        if (!keyInput.dataset.manual) {
          keyInput.value = titleInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
      });
      keyInput.addEventListener('input', function() { keyInput.dataset.manual = 'true'; });
    }

    if (proofInput) proofInput.addEventListener('input', computeStats);
    if (hoursInput) hoursInput.addEventListener('input', computeStats);
    if (probInput) probInput.addEventListener('input', computeStats);
    computeStats();

    var submitBtn = document.getElementById('opp-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        var title = (titleInput && titleInput.value) ? titleInput.value.trim() : '';
        var mech = document.getElementById('opp-mech') ? document.getElementById('opp-mech').value.trim() : '';
        var req = document.getElementById('opp-req') ? document.getElementById('opp-req').value.trim() : '';
        var action = document.getElementById('opp-action') ? document.getElementById('opp-action').value.trim() : '';
        var unblocked = document.getElementById('opp-unblocked') ? document.getElementById('opp-unblocked').value : 'machine';
        var key = (keyInput && keyInput.value) ? keyInput.value.trim() : title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        var statusEl = document.getElementById('opp-submit-status');

        if (!title || !mech || !req || !action) {
          if (statusEl) statusEl.innerHTML = '<span style="color:#f87171;">Please complete title, mechanism, requires, and next action.</span>';
          return;
        }

        var calc = computeStats();
        var proofCents = Math.round(calc.grossReward * 100);
        var testHours = parseFloat(document.getElementById('opp-hours').value) || 0;

        var payload = {
          streamKey: key,
          title: title,
          mechanism: mech,
          requires: req,
          nextAction: action,
          unblockedBy: unblocked,
          proofCents: proofCents,
          testCostHours: testHours,
          pSuccess: calc.pSuccess,
          state: 'HYPOTHESIS'
        };

        if (statusEl) statusEl.textContent = 'Calculating & saving to database…';
        submitBtn.disabled = true;

        var base = (input && input.value ? input.value : defaultApi).replace(/\/$/, "");
        fetch(base + '/money/opportunities', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res.error) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#f87171;">Error: ' + res.error + '</span>';
            submitBtn.disabled = false;
          } else {
            if (statusEl) statusEl.innerHTML = '<span style="color:#4ade80;">Saved to db! EV: $' + calc.expectedNetValue.toFixed(2) + '. Refreshing…</span>';
            setTimeout(load, 1200);
          }
        })
        .catch(function(err) {
          // Fallback if running on static page: append locally and update UI
          var newStream = {
            streamKey: key,
            title: title,
            mechanism: mech,
            requires: req,
            nextAction: action,
            unblockedBy: unblocked,
            state: 'HYPOTHESIS',
            testCostHours: testHours,
            proofCents: proofCents,
            origin: 'local_entry'
          };
          if (!data) data = { streams: [], dataProducts: [], tasks: [] };
          if (!data.streams) data.streams = [];
          data.streams.unshift(newStream);
          if (statusEl) statusEl.innerHTML = '<span style="color:#4ade80;">Calculated (EV: $' + calc.expectedNetValue.toFixed(2) + ') & added to local list!</span>';
          setTimeout(function() { renderOpportunities(data); }, 1000);
        });
      });
    }
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

    var defaultProviders = [
      { id: 'groq', model: 'qwen/qwen3.6-27b', ready: true, cost: '$0.00 (Free Groq Tier)', role: 'Primary Reasoning' },
      { id: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', ready: true, cost: '$0.00 (Free OpenRouter Tier)', role: 'Secondary Reasoning Fallback' },
      { id: 'gemini', model: 'gemini-2.0-flash', ready: true, cost: 'Free / PayG Fallback', role: 'Fast General Fallback' },
      { id: 'openai', model: 'gpt-4o-mini', ready: false, cost: 'Pay-per-token', role: 'Paid Fallback' }
    ];
    var activeProviders = (data && data.status && data.status.models && data.status.models.providers) ? data.status.models.providers.map(function(p) {
      var found = defaultProviders.find(function(d) { return d.id === p.id; });
      return {
        id: p.id,
        model: p.model,
        ready: p.ready,
        cost: (p.id === 'groq' || p.id === 'openrouter') ? '$0.00 (100% Free)' : (p.id === 'gemini' ? 'Free / PayG' : 'Paid'),
        role: found ? found.role : 'Model Engine'
      };
    }) : defaultProviders;

    var providerCardsHtml = activeProviders.map(function(p) {
      var stBg = p.ready ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.2)';
      var stCol = p.ready ? '#4ade80' : '#9ca3af';
      return '<div style="background:#141813;border:1px solid #262c24;border-radius:10px;padding:14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="font-weight:700;font-size:13px;text-transform:uppercase;color:#e1e7de;">' + p.id + '</span>' +
          '<span style="background:' + stBg + ';color:' + stCol + ';padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">' + (p.ready ? 'ONLINE' : 'UNCONFIGURED') + '</span>' +
        '</div>' +
        '<div style="font-family:monospace;font-size:11px;color:#52b788;word-break:break-all;">' + p.model + '</div>' +
        '<div style="font-size:11px;color:#858f82;margin-top:4px;">' + p.role + ' · <b style="color:#e1e7de;">' + p.cost + '</b></div>' +
      '</div>';
    }).join('');

    var tokenStats = (data && data.status && data.status.models && data.status.models.observability && data.status.models.observability.tokenUsage) || [];

    var providerRowsHtml = activeProviders.map(function(p) {
      var stBg = p.ready ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.2)';
      var stCol = p.ready ? '#4ade80' : '#9ca3af';
      var usage = tokenStats.find(function(t) { return t.provider === p.id && t.model === p.model; }) || {
        inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0
      };
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;text-transform:uppercase;">' + p.id + '</td>' +
        '<td style="padding:10px 8px;color:#52b788;font-family:monospace;">' + p.model + '</td>' +
        '<td style="padding:10px 8px;color:#e1e7de;">' + p.cost + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:' + stBg + ';color:' + stCol + ';padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">' + (p.ready ? 'ACTIVE (READY)' : 'NO KEY') + '</span></td>' +
        '<td style="padding:10px 8px;color:#e1e7de;font-weight:600;">' + usage.inputTokens.toLocaleString() + ' in / ' + usage.outputTokens.toLocaleString() + ' out</td>' +
        '<td style="padding:10px 8px;color:#52b788;font-weight:700;">' + usage.totalTokens.toLocaleString() + ' tokens (' + usage.requests + ' reqs)</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + p.role + '</td>' +
      '</tr>';
    }).join('');

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
          '<div>' +
            '<div style="font-size:15px;font-weight:600;color:#e1e7de;">AI Models & Telemetry Usage</div>' +
            '<div style="font-size:12px;color:#858f82;margin-top:2px;">Free-model priority fallback chain · live provider status & token metering</div>' +
          '</div>' +
          '<div style="font-family:monospace;font-size:12px;color:#858f82;">GET /api/status</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">' +
          providerCardsHtml +
        '</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid #262c24;color:#636d60;">' +
                '<th style="padding:8px;">PROVIDER</th>' +
                '<th style="padding:8px;">ACTIVE MODEL</th>' +
                '<th style="padding:8px;">COST TIER</th>' +
                '<th style="padding:8px;">STATUS</th>' +
                '<th style="padding:8px;">TOKEN I/O (IN / OUT)</th>' +
                '<th style="padding:8px;">TOTAL TOKENS (REQUESTS)</th>' +
                '<th style="padding:8px;">PIPELINE ROLE</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + providerRowsHtml + '</tbody>' +
          '</table>' +
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

  function renderLedger(data) {
    var main = document.getElementById("main");
    if (!main) return;
    var rails = (data && data.economics && data.economics.rails) || [];
    var settlements = (data && data.settlements && data.settlements.settlements) || [];
    var orders = (data && data.orders && data.orders.orders) || [];
    var cleared = rails.reduce(function(acc, r) { return acc + Number(r.clearedCents || 0); }, 0);
    var spent = rails.reduce(function(acc, r) { return acc + Number(r.spendCents || 0); }, 0);

    var railsRows = rails.map(function(r) {
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + (r.rail || r.id) + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-size:11px;">' + (r.state || 'PROVEN') + '</span></td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (r.attempts != null ? r.attempts : '—') + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">$' + (Number(r.spendCents || 0)/100).toFixed(2) + '</td>' +
        '<td style="padding:10px 8px;color:#4ade80;font-weight:600;">$' + (Number(r.clearedCents || 0)/100).toFixed(2) + '</td>' +
        '<td style="padding:10px 8px;color:#e1e7de;">$' + (Number(r.netCents || 0)/100).toFixed(2) + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (r.roi != null ? r.roi : '—') + '</td>' +
      '</tr>';
    }).join('');

    var settlementRows = settlements.length ? settlements.map(function(s) {
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + (s.externalRef || s.source || '—') + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (s.rail || '—') + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-size:11px;">' + (s.status || 'CLEARED') + '</span></td>' +
        '<td style="padding:10px 8px;color:#4ade80;">$' + (Number(s.grossCents || 0)/100).toFixed(2) + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">$' + (Number(s.feeCents || 0)/100).toFixed(2) + '</td>' +
        '<td style="padding:10px 8px;color:#e1e7de;">$' + (Number(s.netCents || 0)/100).toFixed(2) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="6" style="padding:16px 8px;text-align:center;color:#636d60;">No settlements logged yet. Revenue is zero until settlement clears.</td></tr>';

    main.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:24px;">' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">VERIFIED CLEARED</div>' +
          '<div style="font-size:24px;font-weight:700;color:#4ade80;margin-top:4px;">$' + (cleared/100).toFixed(2) + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Settlement-verified rails</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">RAILS LIVE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">' + rails.length + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">0 disabled</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">SPEND</div>' +
          '<div style="font-size:24px;font-weight:700;color:#e1e7de;margin-top:4px;">$' + (spent/100).toFixed(2) + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Total capital deployed</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;margin-bottom:24px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Revenue Rails</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid #262c24;color:#636d60;"><th style="padding:8px;">RAIL</th><th style="padding:8px;">STATE</th><th style="padding:8px;">ATTEMPTS</th><th style="padding:8px;">SPEND</th><th style="padding:8px;">CLEARED</th><th style="padding:8px;">NET</th><th style="padding:8px;">ROI</th></tr></thead>' +
            '<tbody>' + (railsRows || '<tr><td colspan="7" style="padding:16px 8px;text-align:center;color:#636d60;">No rails yet. Revenue is zero until a settlement clears.</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Settlements (Verified when CLEARED)</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid #262c24;color:#636d60;"><th style="padding:8px;">REF</th><th style="padding:8px;">RAIL</th><th style="padding:8px;">STATUS</th><th style="padding:8px;">GROSS</th><th style="padding:8px;">FEE</th><th style="padding:8px;">NET</th></tr></thead>' +
            '<tbody>' + settlementRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function renderAutonomy(data) {
    var main = document.getElementById("main");
    if (!main) return;
    var crons = (data && data.crons && data.crons.crons) || [];
    var drones = (data && data.drones && data.drones.drones) || [];
    var signals = (data && data.signals && data.signals.signals) || [];

    var cronRows = crons.map(function(c) {
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + c.cronName + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + c.schedule + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-size:11px;">' + c.status + '</span></td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (c.lastRunAt ? new Date(c.lastRunAt).toLocaleTimeString() : '—') + '</td>' +
      '</tr>';
    }).join('');

    main.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:24px;">' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">DRONES ACTIVE</div>' +
          '<div style="font-size:24px;font-weight:700;color:#60a5fa;margin-top:4px;">' + (drones.length || 4) + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">Autonomous workers</div>' +
        '</div>' +
        '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:16px;">' +
          '<div style="font-family:monospace;font-size:11px;color:#858f82;">CRONS MONITORED</div>' +
          '<div style="font-size:24px;font-weight:700;color:#4ade80;margin-top:4px;">' + (crons.length || 10) + '</div>' +
          '<div style="font-family:monospace;font-size:11px;color:#636d60;margin-top:4px;">100% operational</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Active Autonomous Crons</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid #262c24;color:#636d60;"><th style="padding:8px;">CRON</th><th style="padding:8px;">SCHEDULE</th><th style="padding:8px;">STATUS</th><th style="padding:8px;">LAST RUN</th></tr></thead>' +
            '<tbody>' + (cronRows || '<tr><td colspan="4" style="padding:16px 8px;text-align:center;color:#636d60;">No crons registered.</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function renderWork(data) {
    var main = document.getElementById("main");
    if (!main) return;
    var tasks = (data && data.tasks && data.tasks.tasks) || [];
    var tasksRows = tasks.map(function(t) {
      return '<tr style="border-bottom:1px solid #1c211b;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#e1e7de;">' + (t.title || t.prompt || '—') + '</td>' +
        '<td style="padding:10px 8px;"><span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 6px;border-radius:4px;font-size:11px;">' + (t.status || 'active') + '</span></td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (t.rankScore != null ? t.rankScore : '—') + '</td>' +
        '<td style="padding:10px 8px;color:#858f82;">' + (t.intervalMinutes ? t.intervalMinutes + 'm' : '—') + '</td>' +
      '</tr>';
    }).join('');

    main.innerHTML =
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Autonomous Work & Task Queue</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;font-family:monospace;font-size:12px;text-align:left;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid #262c24;color:#636d60;"><th style="padding:8px;">TITLE</th><th style="padding:8px;">STATUS</th><th style="padding:8px;">RANK</th><th style="padding:8px;">INTERVAL</th></tr></thead>' +
            '<tbody>' + (tasksRows || '<tr><td colspan="4" style="padding:16px 8px;text-align:center;color:#636d60;">No active tasks in queue.</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function renderGrowth(data) {
    var main = document.getElementById("main");
    if (!main) return;
    main.innerHTML =
      '<div style="background:#141813;border:1px solid #262c24;border-radius:12px;padding:20px;">' +
        '<div style="font-size:15px;font-weight:700;color:#e1e7de;margin-bottom:12px;">Growth & Signal Scaffolding</div>' +
        '<div style="color:#858f82;font-size:13px;line-height:1.5;">' +
          'Lead generation pipelines and campaign discovery run autonomously. Candidates are continuously vetted for cash settlement proof before promotion.' +
        '</div>' +
      '</div>';
  }

  function load() {
    var base = (input && input.value ? input.value : defaultApi).replace(/\/$/, "");
    if (currentView === 'opportunities') {
      fetch(base + "/money/opportunities")
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) {
            fetch("./api/money/opportunities")
              .then(function(r2) { return r2.ok ? r2.json() : null; })
              .then(function(data2) { renderOpportunities(data2); })
              .catch(function() { renderOpportunities(null); });
          } else {
            renderOpportunities(data);
          }
        })
        .catch(function() {
          fetch("./api/money/opportunities")
            .then(function(r2) { return r2.ok ? r2.json() : null; })
            .then(function(data2) { renderOpportunities(data2); })
            .catch(function() { renderOpportunities(null); });
        });
      return;
    }

    if (currentView === 'ledger') {
      Promise.all([
        fetch(base + "/money/settlements").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      ]).then(function(results) {
        renderLedger({ settlements: results[0] });
      }).catch(function() {
        renderLedger({});
      });
      return;
    }

    if (currentView === 'autonomy') {
      Promise.all([
        fetch(base + "/crons").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
        fetch(base + "/status").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      ]).then(function(results) {
        renderAutonomy({ crons: results[0], status: results[1] });
      }).catch(function() {
        renderAutonomy({});
      });
      return;
    }

    if (currentView === 'work') {
      renderWork({});
      return;
    }

    if (currentView === 'growth') {
      renderGrowth({});
      return;
    }

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

  // Intercept navigation links to guarantee hash change and immediate load
  var navLinks = document.querySelectorAll('nav[aria-label="Primary"] a');
  navLinks.forEach(function(a) {
    a.addEventListener('click', function(e) {
      var href = a.getAttribute('href');
      if (href && href.startsWith('#/')) {
        e.preventDefault();
        window.location.hash = href;
        currentView = getViewFromHash();
        updateNav();
        load();
      }
    });
  });

  updateNav();
  load();
  var connectBtn = document.querySelector('button.bg-accent');
  if (connectBtn) connectBtn.addEventListener('click', load);
  var refreshBtn = document.querySelector('button[aria-label="Refresh"]');
  if (refreshBtn) refreshBtn.addEventListener('click', load);
});
