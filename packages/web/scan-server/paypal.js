/**
 * Verify a PayPal order server-side. The frontend uses PayPal Smart Buttons to
 * get the buyer's approval and hands us the resulting order id; we confirm with
 * PayPal that it is actually COMPLETED and paid for at least the price before
 * unlocking the report. Never trust the client that it was paid.
 *
 * Needs PAYPAL_CLIENT_ID / PAYPAL_SECRET (the operator's account). Without them
 * it refuses every unlock rather than failing open — a paywall that fails open
 * gives the product away.
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

export async function verifyPayPalOrder(orderId, { minUsd = 5 } = {}) {
  if (!orderId) return false;
  const token = await accessToken();
  if (!token) return false;                       // fail CLOSED: no creds, no unlock
  const res = await fetch(`${BASE()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return false;
  const order = await res.json();
  if (order.status !== 'COMPLETED') return false;
  const paid = (order.purchase_units || []).some(u => Number(u.amount?.value || 0) >= minUsd);
  return paid;
}
