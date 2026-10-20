import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { DerbyProvider } from './lib/derby.tsx';
import { watchErrors } from './lib/errors.ts';
import { watch as watchDiagnostics } from './lib/diag.ts';
import './styles.css';

watchErrors();
watchDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DerbyProvider>
        <App />
      </DerbyProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
