import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { CoinMark } from './components/Funding';
import { MachineMark } from './components/Mark';
import { NotFound } from './components/NotFound';
import { copy } from './lib/copy';
import { useSiteCounts } from './lib/count';
import { siteEnv } from './lib/env';
import { legal } from './lib/legal';
import { useScrollReveal } from './lib/reveal';
import { useSignInOpen } from './lib/sign-in';
import { StudioProvider } from './lib/studio';
import { Contribute } from './pages/Contribute';
import { Ledger } from './pages/Ledger';
import { Contact, Privacy, Refunds, RefundsVersion, Terms, TermsVersion } from './pages/Legal';
import { Thanks } from './pages/Thanks';
import { communityNav, footerNav, pageNav, pageRoutes, youSlot, type PageRoute } from './routes';

// Kernel (docs/specs/board-site.md): the frame of every page (the top bar, the footer with the legal
// links and the credit, and the not found page, drawn by components/NotFound.tsx) and the routes of
// the Contribute, Ledger, legal and /thanks pages, each Terms and Refunds version among them. The card lane's pages come from routes.tsx and never take one of these paths.

/**
 * First path segments only the kernel uses; /board is here so it stays the not found page, /api is
 * the site's functions' (netlify/functions, docs/specs/site-snapshot.md), and /thanks is where
 * Stripe's redirect lands (docs/specs/supporter-pages.md).
 */
export const KERNEL_SEGMENTS: readonly string[] = ['contribute', 'ledger', 'terms', 'privacy', 'refunds', 'contact', 'board', 'api', 'thanks'];

/**
 * The card lane's routes this frame mounts: the landing at /, and pages whose first path segment is
 * plain (lowercase letters, digits and hyphens) and not one of the kernel's. A dynamic, optional or
 * catch-all first segment is dropped, since it could answer a kernel path or /board. Paths match
 * without regard to case, as the router matches them.
 */
export function cardRoutes(routes: readonly PageRoute[]): PageRoute[] {
  return routes.filter(({ path }) => {
    if (path === '/') return true;
    const first = path.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? '';
    return /^[a-z0-9-]+$/.test(first) && !KERNEL_SEGMENTS.includes(first);
  });
}

// A top bar link from routes.tsx goes to a page on this site: a plain path, never another host.
const PLAIN_PATH = /^\/[a-z0-9-]*$/;
// A footer link may go one level deeper (/studio/history), still a plain path on this site.
const PLAIN_PATH_DEEP = /^\/[a-z0-9-]+(\/[a-z0-9-]+)?$/;

/**
 * Page transitions (docs/specs/final-state.md, the motion pass): a press on a link to another page of
 * this site cross-fades through the View Transitions API where the browser has it and motion is
 * allowed; elsewhere, and under reduced motion, the page changes at once as before. The router moves
 * inside the transition's callback, so the old page is captured as the new one renders.
 */
function ViewTransitions() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const start = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition;
      if (typeof start !== 'function' || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (typeof window.matchMedia !== 'function' || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target !== '' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(url.pathname)) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      start.call(document, () => {
        flushSync(() => navigate(url.pathname + url.search + url.hash));
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
  return null;
}

/**
 * Calls onRouteChange on every move to another page after the first render: main.tsx passes the
 * stale-tab check, so a reader who moves to another page lands on it in the newest build.
 */
function useRouteChange(onRouteChange: (() => void) | undefined) {
  const { pathname } = useLocation();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    onRouteChange?.();
  }, [pathname, onRouteChange]);
}

/** The broadcast overlay (docs/specs/final-state.md, Channels) is a frame for a streaming tool: no top bar or footer. */
const BARE_PATHS: readonly string[] = ['/broadcast'];

export function App({ onRouteChange }: { onRouteChange?: () => void } = {}) {
  useRouteChange(onRouteChange);
  useScrollReveal();
  // The benchmarks' daily counts (docs/specs/counter-senders.md): home views and dwell, the broadcast's
  // load and QR landings, Discord presses. Each is a beacon carrying an event name and nothing else.
  useSiteCounts(siteEnv().discordInvite);
  const { pathname } = useLocation();
  const bare = BARE_PATHS.includes(pathname.toLowerCase().replace(/\/+$/, ''));
  return (
    <StudioProvider>
      <div className="page" data-bare={bare ? 'true' : undefined}>
        <ScrollOnNavigate />
        <ViewTransitions />
        {bare ? null : <TopBar />}
        <Routes>
          <Route path="/contribute" element={<Contribute />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/terms/:version" element={<TermsVersion />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refunds" element={<Refunds />} />
          <Route path="/refunds/:version" element={<RefundsVersion />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/thanks" element={<Thanks />} />
          {cardRoutes(pageRoutes).map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
        {bare ? null : <SiteFooter />}
      </div>
    </StudioProvider>
  );
}

/**
 * A link to another page opens it at the top, or at the element its #hash names, not at the last
 * page's scroll position. Back and forward keep the browser's own scroll restoration.
 */
function ScrollOnNavigate() {
  const location = useLocation();
  const type = useNavigationType();
  const last = useRef(location.key);
  useEffect(() => {
    if (location.key === last.current) return;
    last.current = location.key;
    if (type === 'POP') return;
    const target = location.hash === '' ? null : document.getElementById(location.hash.slice(1));
    if (target === null) window.scrollTo(0, 0);
    else target.scrollIntoView();
  }, [location, type]);
  return null;
}

/**
 * The Play link's cartridge: the same drawing as the game suit in Glyph.tsx (App.test.tsx compares
 * them). App.tsx is kernel and may import only kernel files, so it draws its own copy.
 */
export function CartridgeMark() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false" data-glyph="cartridge">
      <path className="glyph-line" d="M3.75 1.75h6.75l1.75 1.75v10.75h-8.5z" />
      <path className="glyph-line" d="M6 4.5h4.25v3.25H6z" />
      <path className="glyph-line" d="M6 11.25v1.25M8 11.25v1.25M10 11.25v1.25" />
    </svg>
  );
}

/**
 * The top bar (DESIGN.md, Top bar), on the signal plate it shares with band 1: the mark (with the
 * name from 32rem), the you slot, Play, Contribute and a Menu button that opens the page links as an
 * inline list; from 64rem the links sit in the row and the Menu button goes. Below 22.5rem Play moves
 * into the list, and below 30rem a signed-out you slot does too (Your desk in the list). Escape closes the list and returns focus to the button, and moving to another page
 * closes it.
 */
function TopBar() {
  const env = siteEnv();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const signInOpen = useSignInOpen();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  // The bar is sticky (DESIGN.md, Top bar): its measured height is --bar, which every other sticky
  // block and every link to a section stops under.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = bar.current;
    if (header === null || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--bar', `${header.offsetHeight}px`));
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--bar');
    };
  }, []);
  const play = env.playUrl === '' ? null : env.playUrl;
  // The you slot is the card lane's code (routes.tsx), so the kernel's own pages (Contribute, /thanks,
  // the ledger and the legal pages) draw the bar without it: nothing a card changes stands on the way
  // to paying.
  // The address is read as the router matches it: decoded (so /%63ontribute is /contribute) and
  // without regard to case.
  const raw = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  let first = raw.toLowerCase();
  try {
    first = decodeURIComponent(raw).toLowerCase();
  } catch {
    // A malformed escape is not a kernel path; the router draws its not found page.
  }
  const kernelPage = KERNEL_SEGMENTS.includes(first);
  return (
    <header className="topbar" ref={bar}>
      <nav
        className="wrap topbar-row"
        aria-label="Site"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <Link className="wordmark" to="/">
          <MachineMark />
          <span className="wordmark-text">{copy.studioName}</span>
        </Link>
        {/* Who is here (routes.tsx, youSlot): Sign in, or the player's avatar and level. */}
        {kernelPage ? null : <span className="you-slot">{youSlot}</span>}
        {play === null ? null : (
          <a className="button button-secondary nav-play" href={play}>
            <CartridgeMark />
            {copy.play}
          </a>
        )}
        {env.stripePaymentLinkUrl === '' ? null : (
          <Link className="button btn-coin nav-contribute" to="/contribute">
            <CoinMark />
            {copy.contribute}
          </Link>
        )}
        <button
          ref={menuButton}
          type="button"
          className="button button-secondary menu-button"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((was) => !was)}
        >
          {copy.menu}
        </button>
        <ul id="site-menu" className="nav-links" data-open={open ? 'true' : undefined}>
          {pageNav
            .filter((item) => PLAIN_PATH.test(item.to))
            .map((item) => (
              <li key={item.to}>
                <NavLink to={item.to}>{item.label}</NavLink>
              </li>
            ))}
          <li>
            <NavLink to="/ledger">{legal.ledger}</NavLink>
          </li>
          {signInOpen ? (
            <li className="menu-you">
              <NavLink to="/me">{copy.nav.me}</NavLink>
            </li>
          ) : null}
          {play === null ? null : (
            <li className="menu-play">
              <a href={play}>{copy.play}</a>
            </li>
          )}
        </ul>
      </nav>
    </header>
  );
}

function SiteFooter() {
  const env = siteEnv();
  // A spec sheet (docs/specs/brand.md, Footer): the mark and what the studio is, then the links in three
  // labelled columns, then the credit under a rule.
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <div className="footer-brand">
          <p className="footer-name" aria-hidden="true">
            <MachineMark />
            <span>{copy.studioName}</span>
          </p>
          <p>
            {copy.footer} {legal.allAges}
          </p>
        </div>
        <div className="footer-group">
          <p className="footer-label">{copy.footerGroups.follow}</p>
          <ul className="footer-links">
            <li>
              <Link to="/reports">{copy.reportsNav}</Link>
            </li>
            <li>
              {/* A file the feed function serves, not a page of the app, so a plain link (docs/specs/ship-feed.md). */}
              <a href="/feed.xml" type="application/atom+xml">
                {copy.feedLink}
              </a>
            </li>
            {footerNav
              .filter((item) => PLAIN_PATH_DEEP.test(item.to))
              .map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
            {env.discordInvite === '' ? null : (
              <li>
                <a href={env.discordInvite}>{copy.discord}</a>
              </li>
            )}
          </ul>
        </div>
        <div className="footer-group">
          <p className="footer-label">{copy.footerGroups.community}</p>
          <ul className="footer-links">
            {communityNav
              .filter((item) => PLAIN_PATH_DEEP.test(item.to))
              .map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
          </ul>
        </div>
        <div className="footer-group">
          <p className="footer-label">{copy.footerGroups.rules}</p>
          <ul className="footer-links">
            <li>
              <Link to="/terms">{legal.footerLinks.terms}</Link>
            </li>
            <li>
              <Link to="/privacy">{legal.footerLinks.privacy}</Link>
            </li>
            <li>
              <Link to="/refunds">{legal.footerLinks.refunds}</Link>
            </li>
            <li>
              <Link to="/contact">{legal.footerLinks.contact}</Link>
            </li>
          </ul>
        </div>
        <p className="credit">
          {copy.createdBy}{' '}
          <a href={copy.createdByUrl}>{copy.createdByName}</a>
        </p>
      </div>
    </footer>
  );
}
