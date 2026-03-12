import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { alpha, styled } from '@mui/material/styles';
import { ComposerPrimitive } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';

const StyledComposerInput = styled(ComposerPrimitive.Input)(({ theme }) => ({
  width: '100%',
  minHeight: 34,
  resize: 'none',
  border: 0,
  backgroundColor: 'transparent',
  color: theme.palette.text.primary,
  padding: theme.spacing(0.5, 0),
  font: 'inherit',
  fontSize: '0.875rem',
  lineHeight: 1.45,
  boxSizing: 'border-box',
  outline: 'none',
  '&::placeholder': {
    color: theme.palette.text.secondary,
    opacity: 1,
  },
  '&:disabled': {
    opacity: 0.72,
    cursor: 'not-allowed',
  },
}));

const StyledSendButton = styled(ComposerPrimitive.Send)(({ theme }) => ({
  width: '100%',
  height: '100%',
  minHeight: 32,
  border: 0,
  borderRadius: 4,
  background: '#3238f2',
  color: '#fff',
  padding: theme.spacing(0, 1.1),
  font: 'inherit',
  fontWeight: 600,
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '0 6px 12px rgba(50,56,242,0.14)',
  transition: 'transform 160ms ease, opacity 160ms ease, background-color 160ms ease',
  '&:not(:disabled):hover': {
    transform: 'translateY(-1px)',
    background: '#282ee8',
  },
  '&:disabled': {
    opacity: 0.55,
    cursor: 'not-allowed',
    transform: 'none',
    background: alpha(theme.palette.primary.main, 0.62),
  },
}));

export default function Composer() {
  const { t } = useTranslation();

  return (
    <ComposerPrimitive.Root>
      <Box
        sx={{
          borderTop: '1px solid rgba(15,23,42,0.08)',
          backgroundColor: 'rgba(255,255,255,0.82)',
          px: { xs: 1, sm: 1.25 },
          py: { xs: 0.9, sm: 1 },
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="flex-end">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <StyledComposerInput
              autoFocus
              minRows={1}
              maxRows={3}
              submitMode="enter"
              placeholder={t('composer.placeholder')}
            />
          </Box>

          <Box sx={{ width: 'auto', minWidth: { xs: 78, sm: 86 }, flexShrink: 0 }}>
            <StyledSendButton>{t('actions.send')}</StyledSendButton>
          </Box>
        </Stack>
      </Box>
    </ComposerPrimitive.Root>
  );
}