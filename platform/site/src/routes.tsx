import type { ReactNode } from 'react';
import { copy } from './lib/copy';
import { Broadcast, BROADCAST_PATH } from './pages/Broadcast';
import { CardPage } from './pages/CardPage';
import { Faq } from './pages/Faq';
import { Goals } from './pages/Goals';
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from './pages/Auth';
import { Me } from './pages/Me';
import { Profile } from './pages/Profile';
import { Seeds } from './pages/Seeds';
import { StudioHistory } from './pages/StudioHistory';
import { Suggest } from './pages/Suggest';
import { Guide, GUIDE_PATH } from './pages/Guide';
import { HowItWorks } from './pages/HowItWorks';
import { Landing } from './pages/Landing';
import { Reports } from './pages/Reports';
import { Team } from './pages/Team';
import { YouChip } from './components/YouChip';

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
  { path: GUIDE_PATH, element: <Guide /> },
  // The final state's community pages (docs/specs/final-state.md): goals, the studio's eras, the
  // suggestions, the seed gallery, a player's public profile, the player's own page and the FAQ.
  { path: '/goals', element: <Goals /> },
  { path: '/studio/history', element: <StudioHistory /> },
  { path: '/suggest', element: <Suggest /> },
  { path: '/seeds', element: <Seeds /> },
  { path: '/u/:handle', element: <Profile /> },
  { path: '/me', element: <Me /> },
  // The account pages (docs/specs/accounts.md): sign in, sign up and reset a password.
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/faq', element: <Faq /> },
  // The broadcast overlay for streaming tools: unlisted, not indexed, drawn without the top bar and footer.
  { path: BROADCAST_PATH, element: <Broadcast /> },
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

/** The footer's Follow along links to these pages, after the reports and the feed. */
export const footerNav: readonly NavItem[] = [{ to: '/studio/history', label: copy.nav.history }];

/** The footer's Take part column: the community pages and the player's own page. */
export const communityNav: readonly NavItem[] = [
  { to: '/suggest', label: copy.nav.suggest },
  { to: '/seeds', label: copy.nav.seeds },
  { to: '/goals', label: copy.nav.goals },
  { to: '/me', label: copy.nav.me },
];
