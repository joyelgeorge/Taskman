export const RAIL_MODE = Object.freeze({ READ_ONLY: 'read_only', EXECUTE: 'execute' });

export class RailAdapter {
  constructor({ name, mode = RAIL_MODE.READ_ONLY } = {}) {
    if (!name) throw new Error('rail name is required');
    this.name = name;
    this.mode = mode;
  }

  assertExecutable(action) {
    if (this.mode !== RAIL_MODE.EXECUTE) {
      throw new Error(`${this.name}: ${action} blocked while rail is read-only`);
    }
  }

  async health() { return { name: this.name, mode: this.mode, ok: true }; }
  async discover() { throw new Error(`${this.name}: discover() not implemented`); }
  async verify() { throw new Error(`${this.name}: verify() not implemented`); }
  async claimOrApply() { this.assertExecutable('claim/apply'); throw new Error(`${this.name}: claimOrApply() not implemented`); }
  async deliver() { this.assertExecutable('deliver'); throw new Error(`${this.name}: deliver() not implemented`); }
  async followUp() { throw new Error(`${this.name}: followUp() not implemented`); }
  async checkAcceptance() { throw new Error(`${this.name}: checkAcceptance() not implemented`); }
  async checkPayment() { throw new Error(`${this.name}: checkPayment() not implemented`); }
}
