/**
 * Array-backed table used when DATABASE_URL is unset.
 *
 * Every store in this package works in both modes so the suite runs without a
 * database. That is not only a test convenience: the memory path is the one CI
 * exercises, so it has to stay honest about uniqueness and ordering.
 */
export class MemoryTable {
  constructor({ unique = [] } = {}) {
    this.rows = [];
    this.unique = unique;
  }

  #conflict(row) {
    if (!this.unique.length) return null;
    return this.rows.find(existing => this.unique.every(key => existing[key] === row[key])) || null;
  }

  insert(row) {
    const conflict = this.#conflict(row);
    if (conflict) return { row: conflict, inserted: false };
    this.rows.push(row);
    return { row, inserted: true };
  }

  upsert(row, patch = null) {
    const conflict = this.#conflict(row);
    if (conflict) {
      Object.assign(conflict, patch ?? row, { id: conflict.id });
      return { row: conflict, inserted: false };
    }
    this.rows.push(row);
    return { row, inserted: true };
  }

  find(predicate) { return this.rows.find(predicate) || null; }
  filter(predicate) { return this.rows.filter(predicate); }
  all() { return [...this.rows]; }
  remove(predicate) {
    const kept = this.rows.filter(r => !predicate(r));
    const removed = this.rows.length - kept.length;
    this.rows = kept;
    return removed;
  }
  clear() { this.rows.length = 0; }
}

export const nowIso = () => new Date().toISOString();
