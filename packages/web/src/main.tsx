import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { DerbyProvider } from './lib/derby.tsx';
import { watchErrors } from './lib/errors.ts';
import './styles.css';

watchErrors();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DerbyProvider>
        <App />
      </DerbyProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
