/**
 * Selects the optimal inbox to send an email from, balancing load
 * across a fleet of satellite domains/inboxes to protect deliverability.
 */

export function getNextInbox(inboxes = []) {
  if (!inboxes || inboxes.length === 0) {
    throw new Error('No inboxes available in the rotation fleet.');
  }
  
  // Filter out inboxes that have reached their daily limit
  const available = inboxes.filter(i => (i.sentCountToday || 0) < (i.dailyLimit || 30));
  
  if (available.length === 0) {
    throw new Error('All inboxes have reached their daily sending limit.');
  }
  
  // Sort by lowest sentCountToday first to evenly distribute load
  available.sort((a, b) => (a.sentCountToday || 0) - (b.sentCountToday || 0));
  
  return available[0];
}
