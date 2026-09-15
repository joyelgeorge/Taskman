import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnauthenticatedAdminRoutes } from '../src/codebase-audit.js';

const FILE = 'src/app/api/admin/tenants/[id]/route.ts';

/**
 * Measured 2026-09-15: this detector reported 6 of 6 admin routes in
 * Chalmers007/ordering-platform as unauthenticated. All six were guarded. The
 * finding was one step from being emailed to the owner, who would have opened
 * the file, seen the guard on line 20, and correctly concluded the rest of the
 * message — including a real leaked service_role key — was noise.
 *
 * The fixture below is that codebase's actual shape: the check is delegated to
 * a named helper, so none of the words the detector looked for appear.
 */
const GUARDED = `
import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';

export async function DELETE(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
`;

const UNGUARDED = `
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function DELETE(request) {
  const { id } = await request.json();
  await db.from('tenants').delete().eq('id', id);
  return NextResponse.json({ deleted: id });
}
`;

test('a route delegating to a named guard helper is not reported', () => {
  assert.deepEqual(findUnauthenticatedAdminRoutes(FILE, GUARDED), []);
});

test('the other guard-naming conventions are recognised too', () => {
  for (const name of ['requireAdmin', 'assertSuperAdmin', 'ensureAuthenticated', 'adminGuard', 'checkPermission']) {
    const text = GUARDED.replace(/requireSuperAdmin/g, name);
    assert.deepEqual(findUnauthenticatedAdminRoutes(FILE, text), [], `${name} not recognised`);
  }
});

test('a genuinely unguarded admin route is still reported', () => {
  // The bite: a fix that simply stops reporting would pass the tests above.
  const found = findUnauthenticatedAdminRoutes(FILE, UNGUARDED);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'unauthenticated-admin-route');
});

test('a guard that is imported but never called does not count as protection', () => {
  const imported = GUARDED.replace('const guard = await requireSuperAdmin();', 'const guard = { ok: true };');
  assert.equal(findUnauthenticatedAdminRoutes(FILE, imported).length, 1,
    'an unused import must not silence the finding');
});

test('a non-admin route is not examined at all', () => {
  assert.deepEqual(findUnauthenticatedAdminRoutes('src/app/api/menu/route.ts', UNGUARDED), []);
});
