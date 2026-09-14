import { describe, expect, it } from 'vitest';
import { resolveBuildSha } from './build-sha';

const head = () => '2775bcb1000a2ebb53a1b03771afb137aae2f50c\n';

describe('resolveBuildSha', () => {
  it('prefers COMMIT_REF, then GITHUB_SHA, then git', () => {
    expect(resolveBuildSha({ COMMIT_REF: 'aaa1111', GITHUB_SHA: 'bbb2222' }, head)).toBe('aaa1111');
    expect(resolveBuildSha({ GITHUB_SHA: 'bbb2222' }, head)).toBe('bbb2222');
    expect(resolveBuildSha({}, head)).toBe('2775bcb1000a2ebb53a1b03771afb137aae2f50c');
  });

  it('treats blank values as unset and trims the rest', () => {
    expect(resolveBuildSha({ COMMIT_REF: '   ', GITHUB_SHA: ' bbb2222 ' }, head)).toBe('bbb2222');
    expect(resolveBuildSha({ COMMIT_REF: '', GITHUB_SHA: '' }, head)).toBe(
      '2775bcb1000a2ebb53a1b03771afb137aae2f50c',
    );
  });
});
