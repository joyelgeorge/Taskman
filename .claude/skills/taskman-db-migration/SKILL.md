---
name: taskman-db-migration
description: >-
  Rules and procedures for PostgreSQL database migrations, schema agreement, and avoiding
  silent data loss in Taskman. Use whenever adding a table, adding columns, modifying check constraints,
  or writing tests that interact with PostgreSQL or memory tables.
metadata:
  purpose: Prevent the recurring defect class where code writes values the schema forbids.
---

# Taskman Database & Migration Protocol

## The Problem This Solves
In this codebase, memory mode enforces no schema, no check constraints, and no foreign keys.
A test suite running in memory mode can be 100% green while completely broken in production:
- Table written by code with no migration existing (`outreach_drafts` was lost for months).
- Code writing an enum value rejected by a PostgreSQL CHECK constraint.
- Storage returning string IDs vs UUIDs inconsistently.

## Rules for Every Schema Change

1. **Numbered SQL Migration**:
   - Add new migration to `packages/db/migrations/NNN_<description>.sql`.
   - Always include `IF NOT EXISTS` on `CREATE TABLE` / `CREATE INDEX`.
   - Ensure CHECK constraints explicitly match code constants (`Object.values(...)`).

2. **Update Schema-Code Agreement Test**:
   - In `test/schema-code-agreement.test.js`:
     - Add table name to `const required = [...]` in the existence test.
     - Add any constrained enum/status columns to `const cases = [...]`.

3. **Run Both Test Modes**:
   ```bash
   # 1. Memory mode test
   npm test

   # 2. Schema agreement check
   node --test test/schema-code-agreement.test.js
   ```

4. **Dual Storage Pattern**:
   - Stores in `@taskman/core` must support both `databaseEnabled: false` (in-memory Map / MemoryTable) and `databaseEnabled: true` (PostgreSQL query).
   - Normalize rows to camelCase across both backends.
   - Always provide a `reset<Entity>Memory()` that clears memory AND calls `truncateForTesting(['table_name'])`.
