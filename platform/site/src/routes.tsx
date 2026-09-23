import type { ReactNode } from 'react';
import { copy } from './lib/copy';
import { HowItWorks } from './pages/HowItWorks';
import { Landing } from './pages/Landing';
import { Roadmap } from './pages/Roadmap';
import { Team } from './pages/Team';

// The site's pages in the platform code lane and their links in the top bar: a card adds a page
// here. App.tsx (kernel) mounts them beside the Contribute, Ledger and legal pages, which it routes
// itself, and drops any page whose path is not a plain one of its own (docs/specs/board-site.md).

export type PageRoute = { readonly path: string; readonly element: ReactNode };
export type NavItem = { readonly to: string; readonly label: string };

export const pageRoutes: readonly PageRoute[] = [
  { path: '/', element: <Landing /> },
  { path: '/how-it-works', element: <HowItWorks /> },
  { path: '/team', element: <Team /> },
  { path: '/roadmap', element: <Roadmap /> },
];

/** The top bar's links to these pages, before the kernel's Ledger, Play, Discord and Contribute. */
export const pageNav: readonly NavItem[] = [
  { to: '/how-it-works', label: copy.howItWorksNav },
  { to: '/team', label: copy.teamNav },
  { to: '/roadmap', label: copy.roadmapNav },
];
