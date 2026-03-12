import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import type { ChatModelAdapter, ThreadMessage, ThreadMessageLike } from '@assistant-ui/core';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChatThread from '@/components/chat/ChatThread';
import Composer from '@/components/chat/Composer';
import LanguageSwitcher from '@/components/common/LanguageSwitcher';
import ConversationSidebar from '@/components/sidebar/ConversationSidebar';
import { notifyUnauthorized } from '@/services/auth.events';
import { authService, type User } from '@/services/auth.service';
import { mockChatService } from '@/services/mock-chat.service';
import type { Conversation } from '@/types/chat';

interface AppShellProps {
  user: User | null;
  onSignedOut: () => void;
}

const drawerWidth = 308;

export default function AppShell({ user, onSignedOut }: AppShellProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    let active = true;

    async function loadConversations() {
      setLoadingConversations(true);
      try {
        const list = await mockChatService.listConversations();
        if (!active) return;
        setConversations(list);
      } finally {
        if (active) {
          setLoadingConversations(false);
        }
      }
    }

    void loadConversations();

    return () => {
      active = false;
    };
  }, []);

  const refreshConversations = useCallback(async (nextSelectedId?: string | null) => {
    const list = await mockChatService.listConversations();
    setConversations(list);
    if (typeof nextSelectedId !== 'undefined') {
      setSelectedConversationId(nextSelectedId);
    }
  }, []);

  async function handleSelectConversation(id: string) {
    setLoadingThread(true);
    try {
      const conversation = await mockChatService.getConversation(id);
      if (!conversation) return;
      setConversations((current) => current.map((item) => (item.id === id ? conversation : item)));
      setSelectedConversationId(id);
      setDrawerOpen(false);
    } finally {
      setLoadingThread(false);
    }
  }

  const handleRunPrompt = useCallback(
    async (prompt: string) => {
      const updatedConversation = await mockChatService.sendPrompt(selectedConversationId, prompt);
      await refreshConversations(updatedConversation.id);
      return updatedConversation;
    },
    [refreshConversations, selectedConversationId],
  );

  async function handleTogglePin(id: string) {
    const updated = await mockChatService.togglePin(id);
    await refreshConversations(updated.id);
  }

  async function handleDelete(id: string) {
    await mockChatService.deleteConversation(id);
    await refreshConversations(selectedConversationId === id ? null : selectedConversationId);
  }

  async function handleSignOut() {
    try {
      await authService.logout();
    } finally {
      notifyUnauthorized();
      onSignedOut();
    }
  }

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      activeId={selectedConversationId}
      loading={loadingConversations}
      userEmail={user?.email ?? null}
      onNewChat={() => {
        setSelectedConversationId(null);
        setDrawerOpen(false);
      }}
      onSelectConversation={handleSelectConversation}
      onTogglePin={handleTogglePin}
      onDeleteConversation={handleDelete}
    />
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        sx={{
          borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
          backdropFilter: 'blur(18px)',
          backgroundColor: 'rgba(250,250,252,0.76)',
        }}
      >
        <Toolbar
          sx={{
            gap: 1.25,
            minHeight: { xs: 56, md: 60 },
            py: 0.75,
            px: { xs: 1.25, sm: 1.75, md: 2 },
            alignItems: 'center',
          }}
        >
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
            {isMobile ? (
              <IconButton
                onClick={() => setDrawerOpen(true)}
                edge="start"
                aria-label={t('app.openSidebar')}
                sx={{
                  width: 34,
                  height: 34,
                  border: '1px solid rgba(15,23,42,0.10)',
                  borderRadius: 1.25,
                  backgroundColor: 'rgba(255,255,255,0.84)',
                  fontSize: '1rem',
                }}
              >
                ≡
              </IconButton>
            ) : null}

            <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily: '"Zen Dots", "Roboto", sans-serif',
                    fontSize: { xs: '0.78rem', sm: '0.88rem' },
                    lineHeight: 1.2,
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  SEIKAIZEN AI
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {t('app.subtitle')}
                </Typography>
              </Box>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flexShrink: 0 }}>
            {!isMobile && user?.email ? (
              <Box
                sx={{
                  alignSelf: 'center',
                  maxWidth: 240,
                  px: 1.1,
                  py: 0.55,
                  borderRadius: 1.25,
                  border: '1px solid rgba(15,23,42,0.08)',
                  backgroundColor: alpha(theme.palette.common.white, 0.7),
                }}
              >
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user.email}
                </Typography>
              </Box>
            ) : null}

            <LanguageSwitcher />

            <Button
              variant="outlined"
              onClick={handleSignOut}
              size="small"
              sx={{
                minWidth: { xs: 86, sm: 94 },
                borderRadius: 1.25,
                backgroundColor: alpha(theme.palette.common.white, 0.72),
              }}
            >
              {t('actions.signOut')}
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          gap: { md: 1.25 },
          px: { xs: 1, sm: 1.25, md: 1.5 },
          pb: { xs: 1, sm: 1.25, md: 1.5 },
          pt: { xs: 0.75, md: 1 },
        }}
      >
        {isMobile ? (
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            PaperProps={{
              sx: {
                width: 'min(100vw - 16px, 348px)',
                maxWidth: drawerWidth,
                borderRadius: 1.5,
                m: 0.75,
                height: 'calc(100% - 12px)',
              },
            }}
          >
            <Box sx={{ width: '100%' }}>{sidebar}</Box>
          </Drawer>
        ) : (
          <Box
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              minHeight: 0,
              borderRadius: 1.5,
              border: '1px solid rgba(15,23,42,0.08)',
              backgroundColor: 'rgba(255,255,255,0.74)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 20px rgba(15,23,42,0.04)',
              overflow: 'hidden',
            }}
          >
            {sidebar}
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
          {loadingConversations ? (
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                borderRadius: 1.5,
                border: '1px solid rgba(15,23,42,0.08)',
                backgroundColor: 'rgba(255,255,255,0.78)',
                boxShadow: '0 8px 20px rgba(15,23,42,0.04)',
              }}
            >
              <Stack sx={{ minHeight: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
              </Stack>
            </Box>
          ) : (
            <AssistantConversationSurface
              key={selectedConversationId ?? 'draft'}
              conversation={activeConversation}
              loading={loadingThread}
              onRunPrompt={handleRunPrompt}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

interface AssistantConversationSurfaceProps {
  conversation: Conversation | null;
  loading: boolean;
  onRunPrompt: (prompt: string) => Promise<Conversation>;
}

function AssistantConversationSurface({
  conversation,
  loading,
  onRunPrompt,
}: AssistantConversationSurfaceProps) {
  const { t } = useTranslation();
  const initialMessages = useMemo(() => toThreadMessages(conversation?.messages ?? []), [conversation]);

  const chatModel = useMemo<ChatModelAdapter>(
    () => ({
      run: async ({ messages }) => {
        const prompt = getLatestUserPrompt(messages);
        if (!prompt) {
          return {
            content: [{ type: 'text', text: 'Unable to process the message.' }],
            metadata: { custom: { variant: 'error' } },
            status: { type: 'complete', reason: 'stop' },
          };
        }

        const updatedConversation = await onRunPrompt(prompt);
        const assistantReply = [...updatedConversation.messages]
          .reverse()
          .find((message) => message.role === 'assistant');

        if (!assistantReply) {
          return {
            content: [{ type: 'text', text: 'No assistant response was returned.' }],
            metadata: { custom: { variant: 'error' } },
            status: { type: 'complete', reason: 'stop' },
          };
        }

        return {
          content: [{ type: 'text', text: assistantReply.content }],
          metadata: { custom: { variant: assistantReply.variant } },
          status: { type: 'complete', reason: 'stop' },
        };
      },
    }),
    [onRunPrompt],
  );

  const runtime = useLocalRuntime(chatModel, { initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 1.5,
          border: '1px solid rgba(15,23,42,0.08)',
          backgroundColor: 'rgba(255,255,255,0.78)',
          boxShadow: '0 8px 20px rgba(15,23,42,0.04)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: { xs: 1.25, sm: 1.75 },
            py: 0.9,
            borderBottom: '1px solid rgba(15,23,42,0.08)',
            backgroundColor: 'rgba(255,255,255,0.44)',
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: 'primary.main',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              flexShrink: 0,
            }}
          >
            Local mock
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {t('app.mockBanner')}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatThread conversation={conversation} loading={loading} />
          <Composer />
        </Box>
      </Box>
    </AssistantRuntimeProvider>
  );
}

function toThreadMessages(messages: Conversation['messages']): ThreadMessageLike[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: [{ type: 'text', text: message.content }],
    createdAt: new Date(message.createdAt),
    metadata: { custom: { variant: message.variant } },
    ...(message.role === 'assistant'
      ? { status: { type: 'complete' as const, reason: 'stop' as const } }
      : {}),
  }));
}

function getLatestUserPrompt(messages: readonly ThreadMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;

    const prompt = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (prompt) {
      return prompt;
    }
  }

  return null;
}