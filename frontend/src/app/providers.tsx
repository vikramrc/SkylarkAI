import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, alpha, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, type PropsWithChildren } from 'react';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3238f2' },
    secondary: { main: '#6d6eff' },
    background: { default: '#fafafc', paper: 'rgba(255, 255, 255, 0.78)' },
    text: { primary: '#111827', secondary: '#667085' },
    divider: 'rgba(15, 23, 42, 0.08)',
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: ['Roboto', 'Inter', 'Helvetica Neue', 'Arial', 'sans-serif'].join(','),
    h3: { fontWeight: 700, letterSpacing: '-0.04em' },
    h4: { fontWeight: 700, letterSpacing: '-0.04em' },
    h5: { fontWeight: 700, letterSpacing: '-0.03em' },
    h6: { fontWeight: 700, letterSpacing: '-0.03em' },
    subtitle1: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '-0.01em', fontSize: '0.8125rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*, *::before, *::after': {
          boxSizing: 'border-box',
        },
        '::selection': {
          backgroundColor: 'rgba(50, 56, 242, 0.16)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(15, 23, 42, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(255, 255, 255, 0.62)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(15, 23, 42, 0.08)',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          minHeight: 34,
          borderRadius: 6,
          paddingInline: 12,
        },
        contained: {
          boxShadow: '0 8px 16px rgba(50, 56, 242, 0.12)',
        },
        outlined: {
          borderColor: 'rgba(15, 23, 42, 0.10)',
          backgroundColor: 'rgba(255, 255, 255, 0.72)',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          backgroundColor: 'rgba(255, 255, 255, 0.58)',
          transition: 'box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(15, 23, 42, 0.10)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(15, 23, 42, 0.18)',
          },
          '&.Mui-focused': {
            backgroundColor: '#fff',
            boxShadow: `0 0 0 3px ${alpha('#3238f2', 0.08)}`,
          },
        },
        input: {
          paddingBlock: 9,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          border: '1px solid rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(8px)',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 14px 28px rgba(15, 23, 42, 0.1)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(10px)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(15, 23, 42, 0.08)',
        },
      },
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      }),
    [],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}