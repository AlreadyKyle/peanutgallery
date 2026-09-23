import { Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { PageHeader } from './components/PageHeader';
import { copy } from './lib/copy';
import { siteEnv } from './lib/env';
import { StudioProvider } from './lib/studio';
import { Contribute } from './pages/Contribute';
import { HowItWorks } from './pages/HowItWorks';
import { Landing } from './pages/Landing';
import { Ledger } from './pages/Ledger';
import { Contact, Privacy, Refunds, Terms } from './pages/Legal';
import { Roadmap } from './pages/Roadmap';
import { Team } from './pages/Team';

export function App() {
  return (
    <StudioProvider>
      <div className="page">
        <TopBar />
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/team" element={<Team />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/contribute" element={<Contribute />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/refunds" element={<Refunds />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Route>
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
          <NavLink to="/how-it-works">{copy.howItWorksNav}</NavLink>
          <NavLink to="/team">{copy.teamNav}</NavLink>
          <NavLink to="/roadmap">{copy.roadmapNav}</NavLink>
          <NavLink to="/ledger">{copy.ledger}</NavLink>
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

function PublicLayout() {
  return <Outlet />;
}

function SiteFooter() {
  const env = siteEnv();
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>{copy.footer}</p>
        <ul className="footer-links">
          <li>
            <Link to="/terms">{copy.footerLinks.terms}</Link>
          </li>
          <li>
            <Link to="/privacy">{copy.footerLinks.privacy}</Link>
          </li>
          <li>
            <Link to="/refunds">{copy.footerLinks.refunds}</Link>
          </li>
          <li>
            <Link to="/contact">{copy.footerLinks.contact}</Link>
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
