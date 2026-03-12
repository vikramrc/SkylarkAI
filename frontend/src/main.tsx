import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import './utils/i18n';
import './index.css';
import { AppProviders } from '@/app/providers';
import RootApp from '@/app/RootApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <RootApp />
    </AppProviders>
  </React.StrictMode>,
);