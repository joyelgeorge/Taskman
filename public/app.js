const $ = (s) => document.querySelector(s);
const MAP = {
  "&": "&" + "amp;",
  "<": "&" + "lt;",
  ">": "&" + "gt;",
  '"': "&" + "quot;",
  "'": "&#39;"
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => MAP[c]);

async function api(path, options) {
  const r = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}

function gateTone(v) {
  if (v === "pass") return "ok";
  if (v === "fail") return "bad";
  return "warn";
}

function renderModels(models) {
  if (!models) return;
  const n = models.counts || {};
  $("#modelCount").textContent = `${n.survivors || 0} survive · ${n.contenders || 0} below threshold · ${n.blocked || 0} blocked`;
  $("#modelNote").textContent = models.note || "";
  const row = (m) => {
    const q = m.qualification || {};
    const fails = (q.hardGateFailures || []).join(", ");
    const tone = m.decision === "SURVIVES" ? "ok" : m.decision === "BELOW_THRESHOLD" ? "warn" : "bad";
    return `
      <div class="item">
        <div class="row">
          <span class="pill ${tone}">${esc(m.decision)}</span>
          <strong>${esc(m.title)}</strong>
          <span class="pill">${esc(q.score)} / ${esc(q.threshold)}</span>
          <span class="pill">${esc(m.profile)}</span>
        </div>
        <div class="muted">${esc(m.moneyFlow)}</div>
        <div class="muted">${esc(m.monetization)}</div>
        ${fails ? `<div class="muted">Hard gates: ${esc(fails)}</div>` : ""}
        <div class="muted"><strong>Next:</strong> ${esc(m.nextValidation)}</div>
      </div>`;
  };
  $("#modelSurvivors").innerHTML = (models.survivors || []).map(row).join("") || '<p class="muted">None crossed freeze. Current money-flow leader still stands.</p>';
  $("#modelContenders").innerHTML = (models.contenders || []).map(row).join("") || '<p class="muted">None.</p>';
  $("#modelBlocked").innerHTML = (models.blocked || []).map(row).join("");
  $("#modelCapture").innerHTML = (models.capture || [])
    .map(
      (c) => `
      <div class="item">
        <div class="row"><strong>${esc(c.title)}</strong></div>
        <div class="muted">${esc(c.how)}</div>
        <div class="muted">${esc(c.when)}</div>
      </div>`,
    )
    .join("");
}

function renderUnbilled(ub) {
  if (!ub) return;
  $("#ubScore").textContent = `${ub.score} / ${ub.threshold}  gap ${ub.gap}`;
  $("#ubDecision").textContent = ub.decision;
  $("#ubDecision").className = `pill ${ub.decision === "SURVIVES" ? "ok" : "warn"}`;
  $("#ubVerdict").textContent = ub.verdict;
  $("#ubTransition").textContent = ub.stateTransition;
  $("#ubGates").innerHTML = (ub.gates || [])
    .map((g) => {
      const tone = g.hardGate ? (g.value >= 0.5 ? "ok" : "bad") : "warn";
      return `<span class="pill ${tone}">${esc(g.key)} ${esc(g.value)}${g.hardGate ? " · gate" : ""}</span>`;
    })
    .join("");
  $("#ubWeak").innerHTML = (ub.weakest || [])
    .map((w) => `<div class="item"><strong>${esc(w.key)} ${esc(w.value)}</strong><div class="muted">${esc(w.note)}</div></div>`)
    .join("");
  const freezeBits = (ub.freezePath?.whatWorks || [])
    .map((s) => `<div class="item"><span class="pill ok">CROSSES ${esc(s.score)}</span><div class="muted">${esc(s.label)}</div></div>`)
    .join("");
  const failBits = (ub.freezePath?.whatFails || [])
    .map((s) => `<div class="item"><span class="pill bad">${esc(s.score)}</span><div class="muted">${esc(s.label)}</div></div>`)
    .join("");
  $("#ubFreeze").innerHTML = `<p class="muted">${esc(ub.freezePath?.implication || "")}</p>${freezeBits}${failBits}`;
  const e = ub.unitEconomics || {};
  $("#ubEcon").innerHTML = `<div>${esc(e.example)}</div><div>${esc(e.conservativeUnbilled)}</div><div>${esc(e.captureRate)}</div>${(e.taskmanTake || []).map((t) => `<div>${esc(t)}</div>`).join("")}`;
  $("#ubKill").innerHTML = (ub.killIf || []).map((k) => `<div class="item muted">${esc(k)}</div>`).join("");
  $("#ubNext").textContent = `Smallest intervention: ${ub.smallestIntervention || ""}`;
}

function renderCollectVsInvoice(cvi) {
  if (!cvi) return;
  const win = (cvi.paths || []).find((p) => p.id === cvi.winner);
  $("#cviWinner").textContent = win ? win.title : cvi.winner;
  $("#cviVerdict").textContent = cvi.verdict;
  $("#cviPaths").innerHTML = (cvi.paths || [])
    .map((p) => {
      const q = p.qualification || {};
      const tone = p.decision === "SURVIVES" ? "ok" : p.decision === "BELOW_THRESHOLD" ? "warn" : "bad";
      return `
        <div class="item">
          <div class="row">
            <span class="pill ${tone}">${esc(q.score)} / ${esc(q.threshold)}</span>
            <strong>${esc(p.title)}</strong>
            ${p.id === cvi.winner ? '<span class="pill ok">money event</span>' : ""}
          </div>
          <div class="muted">${esc(p.what)}</div>
          <div class="muted">${esc(p.when)}</div>
          <div class="muted">${esc(p.moneyEvent)}</div>
        </div>`;
    })
    .join("");
  $("#cviMatrix").innerHTML = (cvi.matrix || [])
    .map(
      (r) => `
      <div class="item">
        <strong>${esc(r.axis)}</strong>
        <div class="muted">Invoice: ${esc(r.invoice)}</div>
        <div class="muted">UPI: ${esc(r.upi)}</div>
        <div class="muted">Both: ${esc(r.both)}</div>
      </div>`,
    )
    .join("");
  $("#cviRules").innerHTML = (cvi.rules || []).map((r) => `<div class="item muted">${esc(r)}</div>`).join("");
}

function renderBrain(brain) {
  const action = brain?.nextAction;
  if (!action) return '<p class="muted">No brain state available.</p>';
  if (action.type === "discover_new_scenario") {
    return `<div><span class="pill">DISCOVER</span><p>${esc(action.reason)}</p></div>`;
  }
  return `
    <div class="row">
      <span class="pill ok">NEXT: ${esc(action.type)}</span>
      <span class="pill">score ${esc(action.scenarioScore)}</span>
    </div>
    <h3>${esc(action.scenarioName)}</h3>
    <p class="muted">${esc(action.gap)}</p>
  `;
}

function renderScenarios(scenarios) {
  const ordered = [...(scenarios || [])];
  $("#scenarioCount").textContent = `${ordered.length} rows`;
  $("#scenarios").innerHTML = ordered.length
    ? ordered
        .map(
          (s) => `
      <div class="item">
        <div class="row"><strong>${esc(s.name)}</strong><span class="pill">${esc(s.status)}</span></div>
        <div class="muted">${esc(s.current_best_path || s.goal || s.decision || "")}</div>
      </div>`,
        )
        .join("")
    : '<p class="muted">No scenario seed on this branch — money-flow history is the live book.</p>';
}

function renderMoney(mf) {
  const latest = mf.latest || {};
  const leader = latest.current_leader || mf.history?.current_leader || {};
  const runs = mf.runs || [];
  const rejections = latest.candidate_events?.rejections || [];
  const runnerUps = latest.runner_ups || [];

  $("#stamp").textContent = latest.run_key ? `Updated ${latest.run_key}` : "";
  $("#leaderName").textContent = leader.name || "No leader";
  $("#leaderWhy").textContent = leader.why_survived || "";
  $("#leaderScore").textContent = leader.score != null ? `${leader.score}/${leader.max_score || 60}` : "—";
  $("#leaderMode").textContent = latest.mode || mf.history?.task?.mode || "SEARCH";
  $("#leaderNext").textContent = leader.next_research_test
    ? `Next test: ${leader.next_research_test}`
    : "";

  $("#leaderGates").innerHTML = Object.entries(leader.gates || {})
    .map(([k, v]) => `<span class="pill ${gateTone(v)}">${esc(k.replaceAll("_", " "))}: ${esc(v)}</span>`)
    .join("");

  $("#kpis").innerHTML = [
    ["Leader score", `${leader.score ?? "—"}/${leader.max_score || 60}`, "Current hypothesis"],
    ["Search runs", String(runs.length), "Immutable history"],
    ["Rejections this run", String(rejections.length), "Killed candidates"],
    ["Threshold", latest.threshold_crossed ? "CROSSED" : "Open", "Build freeze"],
  ]
    .map(
      ([l, n, h]) => `<div class="card kpi" style="margin:0"><div class="muted">${esc(l)}</div><div class="n">${esc(n)}</div><div class="muted">${esc(h)}</div></div>`,
    )
    .join("");

  const activity = runs.slice(0, 10).map((r) => {
    const bits = [];
    if (r.promotions) bits.push(`${r.promotions} promoted`);
    if (r.demotions) bits.push(`${r.demotions} demoted`);
    if (r.rejections) bits.push(`${r.rejections} rejected`);
    return `
      <div class="item">
        <div class="row">
          <span class="pill">${esc(r.mode || "SEARCH")}</span>
          <strong>${esc(r.leader_name || r.leader_id || "run")}</strong>
          <span class="pill">${esc(r.score ?? "—")}</span>
        </div>
        <div class="muted">${esc(r.run_key)} · ${esc(bits.join(" · ") || "no events")}</div>
      </div>`;
  });
  $("#activity").innerHTML = activity.join("") || '<p class="muted">No money-flow runs yet.</p>';

  $("#field").innerHTML = `
    ${runnerUps
      .map(
        (u) => `<div class="item"><div class="row"><span class="pill">#${esc(u.rank)}</span><strong>${esc(u.id)}</strong><span class="pill">${esc(u.score)}</span>${u.status ? `<span class="pill bad">${esc(u.status)}</span>` : ""}</div></div>`,
      )
      .join("")}
    ${rejections
      .map(
        (r) => `<div class="item"><div class="row"><span class="pill bad">rejected</span><strong>${esc(r.id)}</strong></div><div class="muted">${esc(r.fatal_flaw)}</div></div>`,
      )
      .join("")}
  `;
}

async function refresh() {
  const [status, tasks, runs, brain, scenarios, money, models, unbilled, cvi] = await Promise.all([
    api("/api/status"),
    api("/api/tasks"),
    api("/api/runs"),
    api("/api/brain"),
    api("/api/scenarios"),
    api("/api/money-flow"),
    api("/api/revenue-models"),
    api("/api/revenue-models/unbilled"),
    api("/api/collect-vs-invoice"),
  ]);

  renderMoney(money);
  renderUnbilled(unbilled);
  renderCollectVsInvoice(cvi);
  renderModels(models);
  $("#providers").innerHTML = (status.providers || [])
    .map((p) => `<span class="pill ${p.ready ? "ok" : ""}">${esc(p.id)} · ${p.ready ? "ready" : "no key"}</span>`)
    .join("");
  $("#usage").textContent = `${Number(status.usage?.inputTokens || 0) + Number(status.usage?.outputTokens || 0)} tokens · ${status.database?.ok ? "PostgreSQL" : "local fallback"}`;
  $("#brainState").innerHTML = renderBrain(brain);
  renderScenarios(scenarios);

  $("#tasks").innerHTML = tasks.length
    ? tasks
        .map(
          (t) => `
    <div class="item">
      <div class="row"><strong>${esc(t.title)}</strong><span class="pill">${esc(t.status)}</span>${t.intervalMinutes ? `<span class="pill">every ${t.intervalMinutes}m</span>` : '<span class="pill">manual</span>'}</div>
      <div class="muted">${esc(t.prompt)}</div>
      <div class="row" style="margin-top:10px">
        <button data-run="${t.id}">Run now</button>
        <button class="ghost" data-pause="${t.id}">${t.status === "active" ? "Pause" : "Resume"}</button>
      </div>
      ${t.lastResult ? `<div class="result">${esc(t.lastResult)}</div>` : ""}
    </div>`,
        )
        .join("")
    : '<p class="muted">No executable tasks yet. Money-flow search history is still the live activity.</p>';

  $("#runs").innerHTML = runs.length
    ? runs
        .slice(0, 10)
        .map(
          (r) => `
    <div class="item">
      <div class="row"><strong>${esc(r.status)}</strong>${r.provider ? `<span class="pill">${esc(r.provider)}</span>` : ""}<span class="muted">${esc(r.startedAt || r.started_at || "")}</span></div>
      ${r.nextBestAction ? `<p class="muted"><strong>Next:</strong> ${esc(r.nextBestAction)}</p>` : ""}
    </div>`,
        )
        .join("")
    : '<p class="muted">No engine cycles in this session.</p>';
}

$("#create").onclick = async () => {
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: $("#title").value,
        prompt: $("#prompt").value,
        intervalMinutes: $("#interval").value,
      }),
    });
    $("#title").value = "";
    $("#prompt").value = "";
    $("#interval").value = "";
    await refresh();
  } catch (e) {
    alert(e.message);
  }
};

$("#runBrain").onclick = async () => {
  const button = $("#runBrain");
  button.disabled = true;
  button.textContent = "Running…";
  $("#brainResult").innerHTML = '<p class="muted">Resolving the selected gap…</p>';
  try {
    const result = await api("/api/brain/run", { method: "POST" });
    const cycle = result.cycle;
    $("#brainResult").innerHTML = `<div class="result"><strong>${esc(cycle.status)}</strong> · ${esc(cycle.scenarioId || "")}\n${esc(cycle.result?.answer || cycle.error || JSON.stringify(cycle.result || {}, null, 2))}</div>`;
    $("#brainState").innerHTML = renderBrain(result.brainAfter);
  } catch (e) {
    $("#brainResult").innerHTML = `<div class="result">${esc(e.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = "Run brain once";
  }
};

document.addEventListener("click", async (e) => {
  const run = e.target.closest("[data-run]");
  const pause = e.target.closest("[data-pause]");
  try {
    if (run) await api(`/api/tasks/${run.dataset.run}/run`, { method: "POST" });
    if (pause) await api(`/api/tasks/${pause.dataset.pause}/pause`, { method: "POST" });
    if (run || pause) await refresh();
  } catch (err) {
    alert(err.message);
  }
});

refresh();
setInterval(refresh, 12000);
