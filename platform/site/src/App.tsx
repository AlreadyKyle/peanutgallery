import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CoinMark } from './components/Funding';
import { NotFound } from './components/NotFound';
import { copy } from './lib/copy';
import { siteEnv } from './lib/env';
import { legal } from './lib/legal';
import { StudioProvider } from './lib/studio';
import { Contribute } from './pages/Contribute';
import { Ledger } from './pages/Ledger';
import { Contact, Privacy, Refunds, RefundsVersion, Terms, TermsVersion } from './pages/Legal';
import { pageNav, pageRoutes, type PageRoute } from './routes';

// Kernel (docs/specs/board-site.md): the frame of every page (the top bar, the footer with the legal
// links and the credit, and the not found page, drawn by components/NotFound.tsx) and the routes of
// the Contribute, Ledger and legal pages, each Terms and Refunds version among them. The card lane's pages come from routes.tsx and never take one of these paths.

/**
 * First path segments only the kernel uses; /board is here so it stays the not found page, and /api
 * is the snapshot function's (netlify/functions/snapshot.mts, docs/specs/site-snapshot.md).
 */
export const KERNEL_SEGMENTS: readonly string[] = ['contribute', 'ledger', 'terms', 'privacy', 'refunds', 'contact', 'board', 'api'];

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

export function App({ onRouteChange }: { onRouteChange?: () => void } = {}) {
  useRouteChange(onRouteChange);
  return (
    <StudioProvider>
      <div className="page">
        <TopBar />
        <Routes>
          <Route path="/contribute" element={<Contribute />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/terms/:version" element={<TermsVersion />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refunds" element={<Refunds />} />
          <Route path="/refunds/:version" element={<RefundsVersion />} />
          <Route path="/contact" element={<Contact />} />
          {cardRoutes(pageRoutes).map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <SiteFooter />
      </div>
    </StudioProvider>
  );
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
 * The top bar (DESIGN.md, Top bar), on the signal plate it shares with band 1: the peanut mark (with
 * the name from 32rem), Play, Contribute and a Menu button that opens the page links as an inline
 * list; from 64rem the links sit in the row and the Menu button goes. Below 22.5rem Play moves into
 * the list. Escape closes the list and returns focus to the button, and moving to another page
 * closes it.
 */
function TopBar() {
  const env = siteEnv();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const play = env.playUrl === '' ? null : env.playUrl;
  return (
    <header className="topbar">
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
          <img className="mark" src="/peanut.png" alt="" width={256} height={256} />
          <span className="wordmark-text">{copy.studioName}</span>
        </Link>
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
          {env.discordInvite === '' ? null : (
            <li>
              <a href={env.discordInvite}>{copy.discord}</a>
            </li>
          )}
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
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>
          {copy.footer} {legal.allAges}
        </p>
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
          {env.discordInvite === '' ? null : (
            <li>
              <a href={env.discordInvite}>{copy.discord}</a>
            </li>
          )}
        </ul>
        <p className="credit">
          {copy.createdBy}{' '}
          <a href={copy.createdByUrl}>{copy.createdByName}</a>
        </p>
      </div>
    </footer>
  );
}
