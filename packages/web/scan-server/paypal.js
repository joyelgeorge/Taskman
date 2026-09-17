/**
 * Server-side PayPal Orders API. This avoids the browser JS SDK entirely — the
 * SDK is one of the most-blocked scripts on the web (ad blockers, privacy modes)
 * and unreliable to load. Instead we create the order server-side, send the buyer
 * to PayPal's own hosted approval page, and capture on their return. Immune to
 * anything the visitor's browser blocks.
 *
 * Needs PAYPAL_CLIENT_ID / PAYPAL_SECRET (the operator's REST app). Without them
 * every operation fails CLOSED — no order, no unlock — so a misconfigured deploy
 * never gives the report away.
 */
const BASE = () => (process.env.PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');

async function accessToken() {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) return null;
  const res = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) return null;
  return (await res.json()).access_token;
}

/**
 * Safe diagnostic: reports whether credentials are present and whether PayPal
 * accepts them, WITHOUT ever returning the secret or the token. Exists because a
 * failed order creation has several causes (missing secret, sandbox creds against
 * the live API, a disabled app) that are indistinguishable from the outside.
 */
export async function paypalDiagnostic() {
  const env = process.env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live';
  const hasId = Boolean(process.env.PAYPAL_CLIENT_ID);
  const hasSecret = Boolean(process.env.PAYPAL_SECRET);
  if (!hasId || !hasSecret) return { env, hasId, hasSecret, auth: 'skipped - credentials missing' };
  let status = null, ok = false;
  try {
    const res = await fetch(`${BASE()}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64'),
                 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    status = res.status; ok = res.ok;
  } catch (e) { status = 'network error'; }
  return { env, hasId, hasSecret, apiBase: BASE(), authHttpStatus: status,
    auth: ok ? 'accepted' : 'REJECTED - credentials do not match this environment' };
}

/** Create an order and return its id + the hosted approval URL to redirect to. */
export async function createPayPalOrder(scanId, { amountUsd = 5, returnUrl, cancelUrl } = {}) {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`${BASE()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: scanId, description: 'App security fix report',
        amount: { currency_code: 'USD', value: String(amountUsd) } }],
      application_context: { brand_name: 'App Security Scan', user_action: 'PAY_NOW',
        return_url: returnUrl, cancel_url: cancelUrl }
    })
  });
  if (!res.ok) return null;
  const order = await res.json();
  const approve = (order.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');
  return approve ? { orderId: order.id, approveUrl: approve.href } : null;
}

/**
 * Verify (and, if still only approved, capture) an order. Unlocks only when the
 * money is actually captured to us for at least the price. Fails closed.
 */
export async function verifyPayPalOrder(orderId, { minUsd = 5 } = {}) {
  if (!orderId) return false;
  const token = await accessToken();
  if (!token) return false;

  let res = await fetch(`${BASE()}/v2/checkout/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  let order = await res.json();

  // Returned from approval but not yet captured — capture now.
  if (order.status === 'APPROVED') {
    const cap = await fetch(`${BASE()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (cap.ok) order = await cap.json();
  }
  if (order.status !== 'COMPLETED') return false;
  return (order.purchase_units || []).some(u => {
    const cap = u.payments?.captures?.[0];
    const val = Number(cap?.amount?.value || u.amount?.value || 0);
    return val >= minUsd && (!cap || cap.status === 'COMPLETED');
  });
}
