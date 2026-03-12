import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '@/components/common/LanguageSwitcher';
import { authService, type User } from '@/services/auth.service';

interface SignInProps {
  onSuccess: (user: User) => void;
}

export default function SignIn({ onSuccess }: SignInProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verification, setVerification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const securityCode = '731';

  const valid = useMemo(
    () =>
      /.+@.+\..+/.test(email) &&
      password.trim().length >= 6 &&
      verification.trim() === securityCode,
    [email, password, verification],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(
        verification.trim() !== securityCode
          ? t('signIn.securityInvalid')
          : t('signIn.errorInvalid'),
      );
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const result = await authService.login({ email, password });
      onSuccess(result.user);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : t('signIn.errorGeneric'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        position: 'relative',
        px: { xs: 2, sm: 3 },
        py: { xs: 'max(24px, env(safe-area-inset-top))', sm: 3 },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box sx={{ position: 'absolute', top: { xs: 16, sm: 24 }, right: { xs: 16, sm: 24 } }}>
        <LanguageSwitcher />
      </Box>

      <Box sx={{ width: '100%', maxWidth: 560 }}>
        <Card
          variant="outlined"
          sx={{
            width: '100%',
            minHeight: { xs: 'auto', sm: 620 },
            px: { xs: 2.5, sm: 4, md: 4.5 },
            py: { xs: 3, sm: 4 },
            borderRadius: '8px',
            borderColor: 'rgba(15,23,42,0.08)',
            backgroundColor: 'rgba(255,255,255,0.60)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 16px 40px rgba(15, 23, 42, 0.06)',
          }}
        >
          <Stack spacing={3.25}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
              <Typography
                sx={{
                  fontFamily: '"Zen Dots", "Inter", sans-serif',
                  fontSize: { xs: '1.6rem', sm: '1.9rem' },
                  lineHeight: 1.1,
                  letterSpacing: '0.04em',
                  textAlign: 'center',
                }}
              >
                SEIKAIZEN AI
              </Typography>
              <Box
                sx={{
                  mt: 1.5,
                  height: 3,
                  width: 84,
                  background: '#3238f2',
                  clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                }}
              />
            </Box>

            <Stack spacing={0.75}>
              <Typography variant="overline" color="primary.main" fontWeight={700} sx={{ letterSpacing: '0.08em' }}>
                {t('signIn.eyebrow')}
              </Typography>
              <Typography variant="h4" sx={{ fontSize: { xs: '1.7rem', sm: '1.95rem' }, lineHeight: 1.06 }}>
                {t('signIn.title')}
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
                {t('signIn.subtitle')}
              </Typography>
            </Stack>

            {error ? (
              <Alert severity="error" sx={{ borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.76)' }}>
                {error}
              </Alert>
            ) : null}

            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
                    {t('signIn.emailLabel')}
                  </Typography>
                  <TextField
                    placeholder={t('signIn.emailPlaceholder')}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    fullWidth
                    size="small"
                  />
                </Box>

                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
                    {t('signIn.passwordLabel')}
                  </Typography>
                  <TextField
                    placeholder={t('signIn.passwordPlaceholder')}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    fullWidth
                    size="small"
                  />
                </Box>

                <Box
                  sx={{
                    p: { xs: 1.5, sm: 1.75 },
                    borderRadius: '8px',
                    border: '1px solid rgba(15,23,42,0.10)',
                    backgroundColor: 'rgba(255,255,255,0.34)',
                  }}
                >
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>
                        {t('signIn.securityTitle')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {t('signIn.securityHint')}
                      </Typography>
                    </Box>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="stretch">
                      <Box
                        sx={{
                          width: { xs: '100%', sm: 196 },
                          minHeight: 40,
                          px: 1.5,
                          border: '1px solid rgba(15,23,42,0.12)',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255,255,255,0.72)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                        }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ position: 'absolute', top: 6, left: 10, lineHeight: 1 }}
                        >
                          {t('signIn.securityCodeLabel')}
                        </Typography>
                        <Typography sx={{ letterSpacing: '0.32em', fontWeight: 700, fontSize: '0.98rem' }}>
                          {securityCode}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: 1 }}>
                        <TextField
                          placeholder={t('signIn.securityPlaceholder')}
                          value={verification}
                          onChange={(event) =>
                            setVerification(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))
                          }
                          inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                          fullWidth
                          size="small"
                        />
                      </Box>
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      {t('signIn.demoHint')}
                    </Typography>
                  </Stack>
                </Box>

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={submitting}
                  sx={{
                    minHeight: 40,
                    mt: 0.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    borderRadius: '6px',
                  }}
                >
                  {submitting ? t('actions.signingIn') : t('actions.signIn')}
                </Button>

                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                  {t('signIn.helper')}
                </Typography>
              </Stack>
            </Box>
          </Stack>
        </Card>
      </Box>
    </Box>
  );
}