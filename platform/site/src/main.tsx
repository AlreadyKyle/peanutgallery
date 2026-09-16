import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { watchForNewBuild } from './lib/freshness';
import { createSupabaseSource } from './lib/source';
import { SourceProvider } from './lib/studio';
import { getClient } from './lib/supabase';
import './styles.css';

// A tab restored from the back/forward cache runs the build it started with; reload when the
// site has moved on.
watchForNewBuild({ doc: document, win: window, fetchFn: fetch.bind(window), reload: () => { window.location.reload(); } });

const client = getClient();
const source = client === null ? null : createSupabaseSource(client);
const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SourceProvider source={source}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SourceProvider>
  </StrictMode>,
);
