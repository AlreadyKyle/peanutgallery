import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { PageHeader } from './components/PageHeader';
import { copy } from './lib/copy';
import { siteEnv } from './lib/env';
import { legal } from './lib/legal';
import { StudioProvider } from './lib/studio';
import { Contribute } from './pages/Contribute';
import { Ledger } from './pages/Ledger';
import { Contact, Privacy, Refunds, Terms } from './pages/Legal';
import { pageNav, pageRoutes, type PageRoute } from './routes';

// Kernel (docs/specs/board-site.md): the frame of every page (the top bar, the footer with the legal
// links and the credit, and the not found page) and the routes of the Contribute, Ledger and legal
// pages. The card lane's pages come from routes.tsx and never take one of these paths.

/** First path segments only the kernel's pages use; /board is here so it stays the not found page. */
export const KERNEL_SEGMENTS: readonly string[] = ['contribute', 'ledger', 'terms', 'privacy', 'refunds', 'contact', 'board'];

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

export function App() {
  return (
    <StudioProvider>
      <div className="page">
        <TopBar />
        <Routes>
          <Route path="/contribute" element={<Contribute />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refunds" element={<Refunds />} />
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

function TopBar() {
  const env = siteEnv();
  return (
    <header className="topbar">
      <div className="wrap topbar-row">
        <div className="brand">
          <Link className="wordmark" to="/">
            <img className="mark" src="/peanut.png" alt="" width={256} height={256} />
            {copy.studioName}
          </Link>
        </div>
        <nav aria-label="Site">
          {pageNav
            .filter((item) => PLAIN_PATH.test(item.to))
            .map((item) => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          <NavLink to="/ledger">{legal.ledger}</NavLink>
          {env.playUrl === '' ? null : <a href={env.playUrl}>{copy.play}</a>}
          {env.discordInvite === '' ? null : <a href={env.discordInvite}>{copy.discord}</a>}
          {env.stripePaymentLinkUrl === '' ? null : (
            <NavLink className="nav-primary" to="/contribute">
              {copy.contribute}
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  const env = siteEnv();
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>{copy.footer}</p>
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

function NotFound() {
  return (
    <main>
      <PageHeader title={copy.notFound} lede={copy.notFoundBody} />
      <p>
        <Link to="/">{copy.home}</Link>
      </p>
    </main>
  );
}
