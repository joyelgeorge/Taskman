/* Transaction register. Uses the same api()/store helpers from app.js. */

async function loadTransactions() {
  const settlementsBody = document.getElementById('settlements');
  const attemptsBody = document.getElementById('attempts');
  const expensesBody = document.getElementById('expenses');
  const note = document.getElementById('tx-note');
  if (!settlementsBody || typeof api !== 'function') return;

  try {
    const [settlements, attempts, expenses] = await Promise.all([
      api('/api/money/settlements'),
      api('/api/money/attempts'),
      api('/api/finance/expenses')
    ]);

    const settlementRows = settlements.settlements || [];
    const attemptRows = attempts.attempts || [];
    const expenseRows = expenses.expenses || [];
    const cleared = settlementRows.filter(s => s.status === 'CLEARED');
    const pending = settlementRows.filter(s => s.status === 'PENDING');

    if (note) {
      note.textContent = cleared.length
        ? `${cleared.length} cleared settlement(s). Revenue tiles use only CLEARED net cents.`
        : 'Revenue is $0.00 because no settlement has status CLEARED. Log a gig payout or sync Stripe — estimates never count.';
    }

    settlementsBody.innerHTML = settlementRows.length
      ? settlementRows.map(s => `<tr>
          <td class="k">${esc(s.rail)}</td>
          <td><span class="pill ${s.status === 'CLEARED' ? 'ok' : s.status === 'REVERSED' ? 'bad' : 'warn'}">${esc(s.status)}</span></td>
          <td class="k">${esc(s.source)}</td>
          <td class="k">${esc(s.externalRef)}</td>
          <td class="n">${money(s.grossCents)}</td>
          <td class="n">${money(s.feeCents)}</td>
          <td class="n">${money(s.netCents)}</td>
          <td>${esc(ago(s.verifiedAt || s.createdAt))}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty">No settlement rows. This is why revenue is zero.</td></tr>';

    attemptsBody.innerHTML = attemptRows.length
      ? attemptRows.map(a => `<tr>
          <td class="k">${esc(a.rail)}</td>
          <td class="k">${esc(a.candidateKey || '—')}</td>
          <td><span class="pill ${a.status === 'ACCEPTED' || a.status === 'DELIVERED' ? 'ok' : a.status === 'FAILED' || a.status === 'REJECTED' ? 'bad' : 'warn'}">${esc(a.status)}</span></td>
          <td class="n">${money(a.costCents)}</td>
          <td>${esc(ago(a.startedAt))}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No rail attempts yet.</td></tr>';

    expensesBody.innerHTML = expenseRows.length
      ? expenseRows.map(e => `<tr>
          <td class="k">${esc(e.category)}</td>
          <td>${esc(e.description || '—')}</td>
          <td class="n">${money(e.amountCents)}</td>
          <td>${esc(ago(e.incurredAt))}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No expenses recorded.</td></tr>';
  } catch (error) {
    if (note) note.textContent = error.message;
  }
}

document.getElementById('save')?.addEventListener('click', () => setTimeout(loadTransactions, 80));
document.getElementById('refresh')?.addEventListener('click', () => setTimeout(loadTransactions, 80));
setTimeout(loadTransactions, 200);
setInterval(() => { if (typeof store !== 'undefined' && store.base && !document.hidden) loadTransactions(); }, 30_000);
