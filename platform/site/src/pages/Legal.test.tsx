import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legal } from '../lib/legal';
import { TermsLoaderContext, type PostedRow, type TermsLoader } from '../lib/terms';
import { TERMS_VERSIONS } from '../lib/terms-versions';
import { Refunds, RefundsVersion, Terms, TermsVersion } from './Legal';

// The Terms and Refunds pages against a fake versions read (docs/specs/legal-copy.md, Behaviour).
// Times are asserted in Toronto time, so the file passes whatever the process time zone is; the
// Verification runs it with TZ=UTC and TZ=Pacific/Auckland too.

const [V1, V2] = TERMS_VERSIONS;
const V1_AT = '2026-09-23T01:32:51+00:00';
const V2_AT = '2026-09-24T15:00:00+00:00';
const V1_TIME = '22 Sep 2026 at 21:32 Toronto time';
const V2_TIME = '24 Sep 2026 at 11:00 Toronto time';
const BOTH: PostedRow[] = [
  { version: 1, posted_at: V1_AT },
  { version: 2, posted_at: V2_AT },
];

function renderAt(path: string, load: TermsLoader) {
  return render(
    <TermsLoaderContext.Provider value={load}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/terms" element={<Terms />} />
          <Route path="/terms/:version" element={<TermsVersion />} />
          <Route path="/refunds" element={<Refunds />} />
          <Route path="/refunds/:version" element={<RefundsVersion />} />
        </Routes>
      </MemoryRouter>
    </TermsLoaderContext.Provider>,
  );
}

/** A fresh loader per render, so the page's once-per-visit cache never carries between tests. */
const answers = (rows: PostedRow[]): TermsLoader => () => Promise.resolve(rows);
const fails = (): TermsLoader => () => Promise.reject(new Error('read failed'));
const never = (): TermsLoader => () => new Promise<PostedRow[]>(() => {});

async function settled() {
  await waitFor(() => expect(screen.queryByText(legal.termsLoading)).toBeNull());
  return screen.getByRole('main');
}

function h1(): string[] {
  return screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent ?? '');
}

function h2(main: HTMLElement): string[] {
  return within(main)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent ?? '');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('/terms and /refunds', () => {
  it('show the version in force, when it took effect, and each earlier version with its range and link', async () => {
    for (const kind of ['terms', 'refunds'] as const) {
      renderAt(`/${kind}`, answers(BOTH));
      const main = await settled();
      expect(h1(), kind).toEqual([V2![kind].title]);
      expect(within(main).getByText(`Version 2, in force since ${V2_TIME}.`)).toBeTruthy();
      expect(h2(main), kind).toEqual([...V2![kind].sections.map((section) => section.heading), legal.termsEarlier]);
      const earlier = within(main).getByRole('region', { name: legal.termsEarlier });
      const links = within(earlier).getAllByRole('link');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')]), kind).toEqual([
        [`Version 1, in force from ${V1_TIME} until ${V2_TIME}`, `/${kind}/1`],
      ]);
      expect(main.textContent).not.toContain(legal.termsUnconfirmed.slice(0, 30));
      expect(main.textContent).not.toMatch(/[{}]/);
      cleanup();
    }
  });

  it('show version 1 alone, with no earlier list, while version 2 is carried but not posted', async () => {
    renderAt('/terms', answers([{ version: 1, posted_at: V1_AT }]));
    const main = await settled();
    expect(within(main).getByText(`Version 1, in force since ${V1_TIME}.`)).toBeTruthy();
    expect(h2(main)).toEqual(V1!.terms.sections.map((section) => section.heading));
    expect(within(main).queryByRole('region', { name: legal.termsEarlier })).toBeNull();
  });

  it('turn {terms} into a link to the Terms and {refunds} into a link to the Refunds page', async () => {
    renderAt('/refunds', answers(BOTH));
    const after = within(await settled()).getByRole('region', { name: 'After 14 days' });
    expect(within(after).getByRole('link', { name: legal.footerLinks.terms }).getAttribute('href')).toBe('/terms');
  });

  it('say they are loading while the read runs', () => {
    renderAt('/terms', never());
    const loading = screen.getByText(legal.termsLoading);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(h1()).toEqual(['Terms']);
  });

  it('show the newest bundled words with the cannot-confirm notice when the read fails, returns no row or runs ahead of the build', async () => {
    for (const load of [fails(), answers([]), answers([...BOTH, { version: 3, posted_at: '2027-01-01T00:00:00Z' }])]) {
      renderAt('/terms', load);
      const main = await settled();
      expect(h2(main)).toEqual(V2!.terms.sections.map((section) => section.heading));
      const notice = main.querySelector('p.notice');
      expect(notice?.textContent).toBe(legal.termsUnconfirmed.replace('{email}', legal.contactEmail));
      expect(within(notice as HTMLElement).getByRole('link', { name: legal.contactEmail }).getAttribute('href')).toBe(`mailto:${legal.contactEmail}`);
      expect(main.textContent).not.toMatch(/in force since/);
      cleanup();
    }
  });

  it('show the cannot-confirm notice when the read does not answer within 5 seconds', async () => {
    vi.useFakeTimers();
    renderAt('/refunds', never());
    expect(screen.getByText(legal.termsLoading)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4_999);
    });
    expect(screen.getByText(legal.termsLoading)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(legal.termsLoading)).toBeNull();
    expect(screen.getByRole('main').querySelector('p.notice')).not.toBeNull();
    expect(h1()).toEqual([V2!.refunds.title]);
  });
});

describe('/terms/:version and /refunds/:version', () => {
  it('show an earlier version with its range and a link to the version in force', async () => {
    for (const kind of ['terms', 'refunds'] as const) {
      renderAt(`/${kind}/1`, answers(BOTH));
      const main = await settled();
      const title = kind === 'terms' ? 'Terms, version 1' : 'Refunds, version 1';
      expect(h1(), kind).toEqual([title]);
      expect(document.title).toContain(title);
      expect(
        within(main).getByText(
          `Version 1, in force from ${V1_TIME} until ${V2_TIME}. It applies to contributions whose checkout started in that time.`,
        ),
      ).toBeTruthy();
      expect(within(main).getByRole('link', { name: legal.termsCurrentLink }).getAttribute('href')).toBe(`/${kind}`);
      expect(h2(main), kind).toEqual(V1![kind].sections.map((section) => section.heading));
      cleanup();
    }
  });

  it('show the version in force with its since line and no link to itself', async () => {
    renderAt('/terms/2', answers(BOTH));
    const main = await settled();
    expect(h1()).toEqual(['Terms, version 2']);
    expect(within(main).getByText(`Version 2, in force since ${V2_TIME}.`)).toBeTruthy();
    expect(within(main).queryByRole('link', { name: legal.termsCurrentLink })).toBeNull();
  });

  it('are the not found page for a version not posted, not in the build, or not a whole number from 1 to 9999', async () => {
    const cases: [string, PostedRow[]][] = [
      ['/terms/2', [{ version: 1, posted_at: V1_AT }]],
      ['/terms/3', BOTH],
      ['/refunds/3', BOTH],
      ['/terms/0', BOTH],
      ['/terms/01', BOTH],
      ['/terms/1.5', BOTH],
      ['/terms/10000', BOTH],
      ['/refunds/x', BOTH],
    ];
    for (const [path, rows] of cases) {
      renderAt(path, answers(rows));
      await waitFor(() => expect(h1(), path).toEqual(['Not found']));
      cleanup();
    }
  });

  it("show that version's words with the cannot-confirm notice when the read fails", async () => {
    renderAt('/terms/1', fails());
    const main = await settled();
    expect(h1()).toEqual(['Terms, version 1']);
    expect(h2(main)).toEqual(V1!.terms.sections.map((section) => section.heading));
    expect(main.querySelector('p.notice')).not.toBeNull();
  });
});
