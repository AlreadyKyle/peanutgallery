import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createSupabaseSource } from './lib/source';
import { SourceProvider } from './lib/studio';
import { getClient } from './lib/supabase';
import './styles.css';

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
