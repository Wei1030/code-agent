import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { connect } from './api';
import './styles/base.css';
import './styles/shell.css';
import './styles/pages.css';
import './styles/session.css';

connect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A page change is a plain update: as a transition, a streaming reply would keep interrupting it. */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
