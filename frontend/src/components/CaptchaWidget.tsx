import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import { RefreshCcw } from 'lucide-react';
import { authService } from '../services/auth.service';

interface Props {
  value: string;
  onChange: (v: string) => void;
  sessionId?: string | null;
  onSessionIdChange?: (id: string) => void;
  error?: string;
}

export default function CaptchaWidget({ value, onChange, sessionId, onSessionIdChange, error }: Props) {
  const [svg, setSvg] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const remaining = useMemo(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  }, [expiresAt]);

  const mmss = useMemo(() => {
    const m = Math.floor(remaining / 60).toString();
    const s = (remaining % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, [remaining]);

  async function load(initial?: boolean) {
    const r = initial || !sessionId
      ? await authService.generateCaptcha()
      : await authService.refreshCaptcha(sessionId);
    setSvg(r.svg);
    setExpiresAt(Date.now() + r.expiresIn * 1000);
    onSessionIdChange?.(r.sessionId);
  }

  useEffect(() => {
    load(true);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (expiresAt && Date.now() >= expiresAt) {
        // auto-refresh a few seconds after expiry to ensure a valid image
        load();
      }
    }, 1000) as unknown as number;
  }, [expiresAt]);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ position: 'relative', width: { xs: '100%', sm: 200 }, height: 40, border: '1px solid', borderColor: (t) => t.palette.grey[300], bgcolor: (t) => t.palette.grey[100], borderRadius: 1, pl: 1, pr: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', '& svg': { width: '100%', height: '100%' } }} dangerouslySetInnerHTML={{ __html: svg }} />
          <IconButton aria-label="Refresh CAPTCHA" title="Refresh" size="small" onClick={() => load()} sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, border: '1px solid', borderColor: (t) => t.palette.grey[300], bgcolor: '#fff' }}>
            <RefreshCcw size={16} />
          </IconButton>
        </Box>
        <TextField value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter CAPTCHA" required size="small"
          sx={{ flex: 1, maxWidth: { sm: 220 }, '& .MuiOutlinedInput-root': { height: 40 } }} />
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        Expires in: {mmss}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        Enter the characters shown in the image above. Click refresh if the image is unclear.
      </Typography>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{error}</Typography>
      )}
    </Box>
  );
}
