import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      const scriptUrl = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
      if (import.meta.env.DEV || scriptUrl.includes('dev-sw.js')) {
        void reg.unregister().then((unregistered) => {
          if (unregistered && 'caches' in window) {
            caches.keys().then((keys) => {
              keys.forEach((k) => {
                void caches.delete(k);
              });
            });
          }
        });
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
