import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { copy } from './lib/copy';
import { safeSessionStorage } from './lib/freshness';
import { CardPage } from './pages/CardPage';
import { BROADCAST_PATH, GUIDE_PATH } from './pages/paths';
import { HowItWorks } from './pages/HowItWorks';
import { Landing } from './pages/Landing';
import { Reports } from './pages/Reports';
import { Team } from './pages/Team';
import { YouChip, YouMenuLink } from './components/YouChip';

// Home, a card's own page, the top bar's pages and the reports come in the first download (with the
// kernel's Contribute, Ledger and legal pages, which App.tsx routes itself). The pages fewer visits
// reach load on their own when first opened: the design guide, the broadcast overlay, the account
// pages, the community pages and the studio's history.

/** A page's code that failed to load names a build that is no longer served: reload once onto the new one. */
const RELOADED = 'mm:page-chunk-reload';

function lazyPage<T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T): ComponentType {
  return lazy(() =>
    load().then(
      (module) => {
        safeSessionStorage()?.removeItem(RELOADED);
        return { default: module[name] as ComponentType };
      },
      (error: unknown) => {
        const storage = safeSessionStorage();
        if (storage === null || storage.getItem(RELOADED) !== null) throw error;
        storage.setItem(RELOADED, '1');
        window.location.reload();
        return new Promise<never>(() => {});
      },
    ),
  );
}

const Broadcast = lazyPage(() => import('./pages/Broadcast'), 'Broadcast');
const Faq = lazyPage(() => import('./pages/Faq'), 'Faq');
const Goals = lazyPage(() => import('./pages/Goals'), 'Goals');
const SignInPage = lazyPage(() => import('./pages/Auth'), 'SignInPage');
const SignUpPage = lazyPage(() => import('./pages/Auth'), 'SignUpPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/Auth'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/Auth'), 'ResetPasswordPage');
const Me = lazyPage(() => import('./pages/Me'), 'Me');
const Profile = lazyPage(() => import('./pages/Profile'), 'Profile');
const Seeds = lazyPage(() => import('./pages/Seeds'), 'Seeds');
const StudioHistory = lazyPage(() => import('./pages/StudioHistory'), 'StudioHistory');
const Week = lazyPage(() => import('./pages/Week'), 'Week');
const Suggest = lazyPage(() => import('./pages/Suggest'), 'Suggest');
const Guide = lazyPage(() => import('./pages/Guide'), 'Guide');

/**
 * While a page's code loads: an empty main that reaches the foot of the window, so the footer waits
 * below the fold and nothing that is drawn moves when the page arrives.
 */
function PageLoading() {
  return <main className="wide page-loading" aria-busy="true" />;
}

function later(Page: ComponentType): ReactNode {
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}

// The site's pages in the platform code lane and their links in the top bar. This list is a
// kernel design file (platform/gate/design-paths.txt, docs/specs/design-review.md): a new page is
// a kernel pull request, merged on a green gate at its exact head, and no card may change this file.
// App.tsx (kernel) mounts them beside the Contribute, Ledger and legal pages, which it routes itself,
// and drops any page whose path is not a plain one of its own (docs/specs/board-site.md). Every path
// here must be in the kernel route list platform/site/e2e/routes.ts (src/routes.test.ts).

export type PageRoute = { readonly path: string; readonly element: ReactNode };
export type NavItem = { readonly to: string; readonly label: string };

export const pageRoutes: readonly PageRoute[] = [
  { path: '/', element: <Landing /> },
  { path: '/how-it-works', element: <HowItWorks /> },
  { path: '/team', element: <Team /> },
  // A card's own page (docs/specs/supporter-pages.md): the Watch links and /ledger's Stopped rows link it.
  { path: '/card/:id', element: <CardPage /> },
  // The weekly reports (docs/specs/studio-reports.md), linked from the footer.
  { path: '/reports', element: <Reports /> },
  // The design guide: unlisted (no top bar link, nothing links to it) and not indexed (DESIGN.md, Mockups).
  { path: GUIDE_PATH, element: later(Guide) },
  // The final state's community pages (docs/specs/final-state.md): goals, the studio's eras, the
  // suggestions, the seed gallery, a player's public profile, the player's own page and the FAQ.
  { path: '/goals', element: later(Goals) },
  { path: '/studio/history', element: later(StudioHistory) },
  // This week, in public (QUEUE Q-053): the New York week so far, from the public feed.
  { path: '/week', element: later(Week) },
  { path: '/suggest', element: later(Suggest) },
  { path: '/seeds', element: later(Seeds) },
  { path: '/u/:handle', element: later(Profile) },
  { path: '/me', element: later(Me) },
  // The account pages (docs/specs/accounts.md): sign in, sign up and reset a password.
  { path: '/sign-in', element: later(SignInPage) },
  { path: '/sign-up', element: later(SignUpPage) },
  { path: '/forgot-password', element: later(ForgotPasswordPage) },
  { path: '/reset-password', element: later(ResetPasswordPage) },
  { path: '/faq', element: later(Faq) },
  // The broadcast overlay for streaming tools: unlisted, not indexed, drawn without the top bar and footer.
  { path: BROADCAST_PATH, element: later(Broadcast) },
];

/** The top bar's links to these pages, before the kernel's Ledger, Play and Contribute. The top bar
 * keeps to the pages a first visit needs; the rest are in the footer (docs/specs/brand.md). */
export const pageNav: readonly NavItem[] = [
  { to: '/suggest', label: copy.nav.suggest },
  { to: '/team', label: copy.teamNav },
  { to: '/how-it-works', label: copy.howItWorksNav },
  { to: '/faq', label: copy.nav.faq },
];

/**
 * The top bar's you slot (docs/specs/place.md): Sign in, or the signed-in player's avatar and level,
 * a link to /me. App.tsx (kernel) draws it from here, so the frame imports no community code itself.
 */
export const youSlot: ReactNode = <YouChip />;

/** The Menu's you link below 30rem (docs/specs/place.md): Sign in for a visitor, Your desk for a player. */
export const menuYou: ReactNode = <YouMenuLink />;

/** The footer's Follow along links to these pages, after the reports and the feed. */
export const footerNav: readonly NavItem[] = [
  { to: '/week', label: copy.nav.week },
  { to: '/studio/history', label: copy.nav.history },
];

/** The footer's Take part column: the community pages and the player's own page. */
export const communityNav: readonly NavItem[] = [
  { to: '/suggest', label: copy.nav.suggest },
  { to: '/seeds', label: copy.nav.seeds },
  { to: '/goals', label: copy.nav.goals },
  { to: '/me', label: copy.nav.me },
];
