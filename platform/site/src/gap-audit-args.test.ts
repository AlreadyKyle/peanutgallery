import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDTHS, parseGapAuditArgs } from '../scripts/gap-audit-args.mjs';

describe('the gap audit command line (scripts/gap-audit.mjs)', () => {
  it('audits a single page at the default widths when --widths is absent', () => {
    expect(parseGapAuditArgs(['https://example.com/'])).toEqual({ targets: ['https://example.com/'], widths: [...DEFAULT_WIDTHS] });
  });

  it('keeps the first of several pages when --widths is absent', () => {
    expect(parseGapAuditArgs(['home.html', 'team.html'])?.targets).toEqual(['home.html', 'team.html']);
  });

  it('reads the value after --widths as widths, wherever the flag sits, and never as a page', () => {
    expect(parseGapAuditArgs(['--widths', '1440,375', 'a.html', 'b.html'])).toEqual({ targets: ['a.html', 'b.html'], widths: [1440, 375] });
    expect(parseGapAuditArgs(['a.html', '--widths', '768', 'b.html'])).toEqual({ targets: ['a.html', 'b.html'], widths: [768] });
  });

  it('is a usage error with no page, a missing width list or a width that is not a positive number', () => {
    expect(parseGapAuditArgs([])).toBeNull();
    expect(parseGapAuditArgs(['--widths', '1440'])).toBeNull();
    expect(parseGapAuditArgs(['a.html', '--widths'])).toBeNull();
    expect(parseGapAuditArgs(['a.html', '--widths', '1440,wide'])).toBeNull();
    expect(parseGapAuditArgs(['a.html', '--widths', '0'])).toBeNull();
  });
});
