import { Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { copy } from './lib/copy';
import { siteEnv } from './lib/env';
import { formatUsd } from './lib/format';
import { StudioProvider, useStudio } from './lib/studio';
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
  const studio = useStudio();
  const balance =
    studio.state === 'ready' && studio.snapshot.pool !== null
      ? formatUsd(studio.snapshot.pool.balance_usd)
      : null;
  return (
    <header className="topbar">
      <div className="wrap topbar-row">
        <div className="brand">
          <Link className="wordmark" to="/">
            {copy.studioName}
          </Link>
          {balance === null ? null : (
            <span className="status">
              {copy.pool} {balance}
            </span>
          )}
        </div>
        <nav aria-label="Site">
          <NavLink to="/" end>
            {copy.studio}
          </NavLink>
          <NavLink to="/ledger">{copy.ledger}</NavLink>
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
      <div className="masthead">
        <h1 className="display">{copy.notFound}</h1>
        <p>{copy.notFoundBody}</p>
      </div>
      <p>
        <Link className="more" to="/">
          {copy.studio}
        </Link>
      </p>
    </main>
  );
}
