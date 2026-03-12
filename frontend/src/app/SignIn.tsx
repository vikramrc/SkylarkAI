import { useMemo, useState } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import FormLabel from '@mui/material/FormLabel';
import { authService } from '../services/auth.service';
import type { LoginBody } from '../services/auth.service';
import CaptchaWidget from '../components/CaptchaWidget';

interface Props { onSuccess: (user?: any) => void }

export default function SignIn({ onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState<string>('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  const valid = useMemo(() => /.+@.+\..+/.test(email) && password.length >= 6 && captchaInput.trim().length >= 3, [email, password, captchaInput]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true); setError('');
    try {
      const body: LoginBody = { email, password, captchaSessionId, captchaInput };
      const res = await authService.login(body);
      onSuccess(res?.user);
    } catch (e: any) {
      const d = e?.response?.data;
      if (d?.captchaError) {
        setError(d?.message || 'Invalid CAPTCHA');
      } else {
        setError(d?.message || 'Login failed');
      }
      // remount the widget to refresh image/session after error
      setCaptchaKey((k) => k + 1);
      setCaptchaInput('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <CssBaseline />
      {/* Restore soft radial background */}
      <div className="background-container" aria-hidden>
        <svg className="background-svg" viewBox="0 0 1450 678" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0h1440v807H0V0Z" fill="url(#a)"></path>
          <defs>
            <radialGradient id="a" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(340.49937606 556.463845 -1058.73086457 647.8357975 400.5 241.266)">
              <stop stopColor="#E5CCFF"></stop>
              <stop offset=".305881" stopColor="#CCF"></stop>
              <stop offset=".601058" stopColor="#FFF6CC"></stop>
              <stop offset="1" stopColor="#FAFAFC" stopOpacity="0"></stop>
            </radialGradient>
          </defs>
        </svg>
      </div>

      <Box className="relative z-10" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
        <Card variant="outlined" sx={{ width: '100%', maxWidth: 560, minHeight: 620, p: 4, display: 'flex', flexDirection: 'column', gap: 2, bgcolor: 'rgba(255,255,255,0.60)', backdropFilter: 'blur(12px)', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '8px', boxShadow: '0 4px 18px rgba(15,23,42,0.08)' }}>
          {/* Brand */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', mb: 3, mt: 2 }}>
            <Typography sx={{ textAlign: 'center', userSelect: 'none', fontFamily: '"Zen Dots", "Inter", sans-serif', color: '#475569', fontSize: 'clamp(2.5rem, 8vw, 4rem)', lineHeight: 1.2, fontWeight: 400 }}>SKYLARK</Typography>
            <Box sx={{ height: 3, width: 84, borderRadius: 0, mt: 1.5, background: 'linear-gradient(90deg,#2563EB,#1e40af)', clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)' }} />
          </Box>

          {error && (
            <Typography color="error" sx={{ textAlign: 'center', mb: 1 }}>{error}</Typography>
          )}

          <Box component="form" onSubmit={onSubmit} noValidate sx={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 3 }}>
            <div>
              <FormLabel htmlFor="email" sx={{ mb: 0.5 }}>Email</FormLabel>
              <TextField id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" autoComplete="email" autoFocus required fullWidth size="small"
                sx={{ '& .MuiOutlinedInput-root': { height: 48, borderRadius: '6px' } }} />
            </div>

            <div>
              <FormLabel htmlFor="password" sx={{ mb: 0.5 }}>Password</FormLabel>
              <TextField id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" autoComplete="current-password" required fullWidth size="small"
                sx={{ '& .MuiOutlinedInput-root': { height: 48, borderRadius: '6px' } }} />
            </div>

            <div>
              <FormLabel htmlFor="captcha" sx={{ mb: 0.5 }}>Security verification</FormLabel>
              <Box sx={{ p: 1.5, borderRadius: '6px', border: '1px solid rgba(15,23,42,0.12)', background: 'rgba(255,255,255,0.60)', backdropFilter: 'blur(10px)' }}>
                <CaptchaWidget key={captchaKey} value={captchaInput} onChange={setCaptchaInput} sessionId={captchaSessionId} onSessionIdChange={setCaptchaSessionId} />
              </Box>
            </div>

            <Button type="submit" fullWidth variant="contained"
              disabled={!valid || submitting}
              sx={{ mt: 2.5, height: 40, textTransform: 'uppercase', fontWeight: 600, bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' } }}>
              {submitting ? 'Signing in…' : 'SIGN IN'}
            </Button>
          </Box>
        </Card>
      </Box>
    </div>
  );
}
