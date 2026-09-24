// The gap audit's command line (scripts/gap-audit.mjs): the pages to audit and the widths to audit
// them at. Pure, so a test can hold the parsing without launching a browser.

export const DEFAULT_WIDTHS = [1440, 1024, 768, 375, 320];

/**
 * The targets and widths in `args`, or null on a usage error: no target, `--widths` with no value,
 * or a width that is not a positive number. The value after `--widths` is a width list, never a
 * target; without the flag every argument that is not a flag is a target.
 */
export function parseGapAuditArgs(args) {
  const widthsAt = args.indexOf('--widths');
  const widths = widthsAt === -1 ? [...DEFAULT_WIDTHS] : (args[widthsAt + 1] ?? '').split(',').map(Number);
  const targets = args.filter((arg, i) => !arg.startsWith('--') && (widthsAt === -1 || i !== widthsAt + 1));
  if (targets.length === 0 || widths.some((width) => !Number.isFinite(width) || width <= 0)) return null;
  return { targets, widths };
}
