/**
 * Read a flag from argv in either `--name=value` or `--name value` form.
 *
 * Three scripts had their own copy of this and two of them accepted only the
 * `=` form, while CLAUDE.md, the outreach skill and docs/outreach/ready all
 * documented the space form. The result was "lane is required" — a correct
 * error for the wrong reason — landing at the one moment that matters: the
 * operator has just sent a real message to a real person and is trying to
 * record it. An attempt that is harder to log than to make goes unlogged.
 */
export function readFlag(args = [], name) {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);

  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = args[i + 1];
  // `--lane --channel=x` means lane was given no value, not that its value is
  // the next flag.
  return next && !next.startsWith('--') ? next : null;
}

export function hasFlag(args = [], name) {
  return args.includes(`--${name}`) || args.some(a => a.startsWith(`--${name}=`));
}

