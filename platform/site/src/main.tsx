import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { safeSessionStorage, watchForNewBuild } from './lib/freshness';
import { createSnapshotSource } from './lib/source';
import { SourceProvider } from './lib/studio';
import { clearStoredSessions } from './lib/supabase';
import './styles.css';

// Kernel (docs/specs/board-site.md): the entry index.html loads. It builds the data source every
// figure comes through (the site's own /api documents, docs/specs/site-snapshot.md), clears any
// stored session and mounts the kernel frame in App.tsx.
//
// A tab restored from the back/forward cache, returned to, or moved to another page runs the build
// it started with; reload when the site has moved on, at most once per served build.
const freshness = watchForNewBuild({
  doc: document,
  win: window,
  fetchFn: fetch.bind(window),
  reload: () => {
    window.location.reload();
  },
  storage: safeSessionStorage(window),
});

try {
  clearStoredSessions(window.localStorage);
} catch {
  // Storage blocked by the browser: there is nothing stored to clear.
}

const source = createSnapshotSource({ fetchFn: fetch.bind(window) });
const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SourceProvider source={source}>
      <BrowserRouter>
        <App onRouteChange={freshness.check} />
      </BrowserRouter>
    </SourceProvider>
  </StrictMode>,
);
