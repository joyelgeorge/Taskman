import { migrate, healthCheck, pool } from '../src/db.js';

try {
  const health = await healthCheck();
  if (!health.ok) throw new Error(health.reason || 'database unavailable');
  const result = await migrate();
  console.log(JSON.stringify({ health, migration: result }, null, 2));
} finally {
  if (pool) await pool.end();
}
