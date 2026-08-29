export const RAIL_MODE = Object.freeze({
  READ_ONLY: 'read_only',
  EXECUTE: 'execute'
});

export class RailAdapter {
  constructor({ name, mode = RAIL_MODE.READ_ONLY } = {}) {
    this.name = name;
    this.mode = mode;
  }

  setMode(mode) {
    if (!Object.values(RAIL_MODE).includes(mode)) {
      throw new Error(`Invalid rail mode: ${mode}`);
    }
    this.mode = mode;
  }

  assertExecutable(action = 'execute') {
    if (this.mode === RAIL_MODE.READ_ONLY) {
      throw new Error(`Execution ${action} blocked while rail is read-only`);
    }
  }
}
