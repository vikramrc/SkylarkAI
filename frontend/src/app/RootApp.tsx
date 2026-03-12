import { useEffect, useState } from 'react';
import App from './App';
import SignIn from './SignIn';
import { authService } from '../services/auth.service';
import { onUnauthorized } from '../services/auth.events';

export default function RootApp() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const off = onUnauthorized(() => {
      if (!mounted) return;
      setAuthed(false);
    });
    authService
      .check()
      .then((r) => { if (!mounted) return; setAuthed(Boolean(r?.authenticated)); })
      .catch(() => { if (!mounted) return; setAuthed(false); })
      .finally(() => { if (!mounted) return; setChecking(false); });
    return () => { mounted = false; off(); };
  }, []);

  if (checking) return null;
  if (!authed) return <SignIn onSuccess={() => setAuthed(true)} />;
  return <App />;
}

