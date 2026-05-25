import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AdminApp } from '@/components/Admin/AdminApp';
import { AppProvider } from '@/context/AppContext';

const isAdmin = window.location.pathname.startsWith('/admin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin
      ? <AdminApp />
      : <AppProvider><App /></AppProvider>
    }
  </StrictMode>,
);
