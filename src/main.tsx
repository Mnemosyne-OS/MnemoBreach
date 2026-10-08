import React from 'react';
import ReactDOM from 'react-dom/client';
import { onHostConfig } from './sdk/mnemo-sdk';
import App from './App';
import './app.css';
import { adoptHostLang } from './i18n/useI18n';

/** The SDK applies the shell's theme on its own and hands us its language.
 *  Registered before render so the first paint is already themed. */
onHostConfig((cfg) => {
  adoptHostLang(cfg.lang);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
