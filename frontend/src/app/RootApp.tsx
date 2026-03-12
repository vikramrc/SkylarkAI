import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppShell from '@/app/AppShell';
import SignIn from '@/app/SignIn';
import { onUnauthorized } from '@/services/auth.events';
import { authService, type User } from '@/services/auth.service';

export default function RootApp() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let mounted = true;
    const off = onUnauthorized(() => {
      if (!mounted) return;
      setAuthed(false);
      setUser(null);
    });

    authService
      .check()
      .then((result) => {
        if (!mounted) return;
        setAuthed(Boolean(result.authenticated));
        setUser(result.user ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthed(false);
        setUser(null);
      })
      .finally(() => {
        if (!mounted) return;
        setChecking(false);
      });

    return () => {
      mounted = false;
      off();
    };
  }, []);

  if (checking) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 3 }}>
        <Stack
          spacing={2}
          alignItems="center"
          sx={{
            px: { xs: 3, sm: 4 },
            py: { xs: 3.5, sm: 4.5 },
            borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(18px)',
            border: '1px solid rgba(15,23,42,0.08)',
            boxShadow: '0 18px 60px rgba(15,23,42,0.08)',
            maxWidth: 520,
          }}
        >
          <CircularProgress />
          <Typography variant="h6">{t('app.sessionChecking')}</Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t('app.sessionCheckingHint')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (!authed) {
    return (
      <SignIn
        onSuccess={(nextUser) => {
          setAuthed(true);
          setUser(nextUser);
        }}
      />
    );
  }

  return <AppShell user={user} onSignedOut={() => setAuthed(false)} />;
}