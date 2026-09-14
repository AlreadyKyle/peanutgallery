import { Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { PageHeader } from './components/PageHeader';
import { copy } from './lib/copy';
import { siteEnv } from './lib/env';
import { StudioProvider } from './lib/studio';
import { Board } from './pages/Board';
import { Landing } from './pages/Landing';
import { Ledger } from './pages/Ledger';

export function App() {
  return (
    <StudioProvider>
      <div className="page">
        <TopBar />
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="/board" element={<Board />} />
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
            {copy.studioName}
          </Link>
        </div>
        <nav aria-label="Site">
          <NavLink to="/" end>
            {copy.studio}
          </NavLink>
          <NavLink to="/ledger">{copy.ledger}</NavLink>
          {env.playUrl === '' ? null : <a href={env.playUrl}>{copy.play}</a>}
          {env.stripePaymentLinkUrl === '' ? null : (
            <a href={env.stripePaymentLinkUrl}>{copy.contribute}</a>
          )}
          {env.discordInvite === '' ? null : <a href={env.discordInvite}>{copy.discord}</a>}
        </nav>
      </div>
    </header>
  );
}

function PublicLayout() {
  return <Outlet />;
}

function SiteFooter() {
  const env = siteEnv();
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>{copy.footer}</p>
        {env.discordInvite === '' ? null : (
          <a className="more" href={env.discordInvite}>
            {copy.discord}
          </a>
        )}
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
        <Link className="more" to="/">
          {copy.studio}
        </Link>
      </p>
    </main>
  );
}
