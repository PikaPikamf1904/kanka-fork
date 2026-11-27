import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/400-italic.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles/theme.css';
import { App } from './App.tsx';
import { watchForNewRelease } from './lib/chunkRecovery.ts';

// Notice a new release before the reader opens a page whose files it deleted (see chunkRecovery.ts).
watchForNewRelease();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
