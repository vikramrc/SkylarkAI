import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@/types/chat';

interface ChatThreadProps {
  conversation: Conversation | null;
  loading: boolean;
}

export default function ChatThread({ conversation, loading }: ChatThreadProps) {
  const { t } = useTranslation();
  const suggestions = [
    t('chat.suggestionOne'),
    t('chat.suggestionTwo'),
    t('chat.suggestionThree'),
  ];

  if (loading) {
    return (
      <Stack sx={{ minHeight: '100%', alignItems: 'center', justifyContent: 'center' }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">{t('chat.loadingThread')}</Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {conversation ? (
        <Box
          sx={{
            px: { xs: 1.25, sm: 1.75 },
            py: { xs: 1.1, sm: 1.2 },
            borderBottom: '1px solid rgba(15,23,42,0.08)',
            backgroundColor: alpha('#ffffff', 0.48),
          }}
        >
          <Typography variant="h5" sx={{ fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>
            {conversation.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            {conversation.preview}
          </Typography>
        </Box>
      ) : null}

      <ThreadPrimitive.Root style={{ flex: 1, minHeight: 0 }}>
        <ThreadPrimitive.Viewport
          autoScroll
          scrollToBottomOnInitialize
          scrollToBottomOnRunStart
          scrollToBottomOnThreadSwitch
          style={{ height: '100%', overflowY: 'auto', padding: conversation ? '18px 18px 0' : '24px 18px 0' }}
        >
          <ThreadPrimitive.Empty>
            <Stack
              sx={{
                minHeight: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                px: { xs: 1, sm: 2 },
                py: { xs: 3, sm: 5 },
              }}
              spacing={2.25}
            >
              <Box
                sx={{
                  width: 76,
                  height: 76,
                  border: '1px solid rgba(15,23,42,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.92)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 28,
                    border: '1.5px solid #3238f2',
                    borderRadius: '6px',
                    position: 'relative',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      left: 6,
                      right: 6,
                      top: 8,
                      height: 2,
                      backgroundColor: '#3238f2',
                    },
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      left: 6,
                      right: 10,
                      top: 14,
                      height: 2,
                      backgroundColor: alpha('#3238f2', 0.55),
                    },
                  }}
                />
              </Box>

              <Stack spacing={0.75} sx={{ alignItems: 'center', maxWidth: 560 }}>
                <Typography
                  variant="h4"
                  sx={{ fontSize: { xs: '1.7rem', sm: '2.1rem' }, textAlign: 'center', lineHeight: 1.06 }}
                >
                  {t('chat.emptyTitle')}
                </Typography>
                <Typography color="text.secondary" textAlign="center" maxWidth={520}>
                  {t('chat.emptyBody')}
                </Typography>
              </Stack>

              <Box
                sx={{
                  width: '100%',
                  maxWidth: 680,
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                {suggestions.map((item, index) => (
                  <Box
                    key={item}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      backgroundColor: 'rgba(255,255,255,0.78)',
                      border: '1px solid rgba(15,23,42,0.08)',
                      ...(index === 2 ? { gridColumn: { md: '1 / -1' } } : {}),
                    }}
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {item}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Stack>
          </ThreadPrimitive.Empty>

          <Box sx={{ maxWidth: 920, width: '100%', mx: 'auto' }}>
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserMessageBubble,
                AssistantMessage: AssistantMessageBubble,
              }}
            />
          </Box>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </Box>
  );
}

const markdownPartComponents = {
  Text: MarkdownMessageText,
};

function UserMessageBubble() {
  return (
    <MessagePrimitive.Root>
      <Box display="flex" justifyContent="flex-end" sx={{ mb: 1.5 }}>
        <Paper
          elevation={0}
          sx={{
            maxWidth: { xs: '94%', sm: '82%' },
            px: 1.5,
            py: 1,
            borderRadius: '8px 8px 2px 8px',
            background: '#3238f2',
            color: '#fff',
            boxShadow: '0 8px 18px rgba(50,56,242,0.14)',
          }}
        >
          <MessagePrimitive.Parts components={markdownPartComponents} />
        </Paper>
      </Box>
    </MessagePrimitive.Root>
  );
}

function AssistantMessageBubble() {
  return (
    <MessagePrimitive.Root>
      <Box display="flex" justifyContent="flex-start" sx={{ mb: 1.5 }}>
        <Paper
          elevation={0}
          sx={{
            maxWidth: { xs: '100%', sm: '86%' },
            px: 1.5,
            py: 1,
            borderRadius: '8px 8px 8px 2px',
            backgroundColor: 'rgba(255,255,255,0.94)',
            color: 'text.primary',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            boxShadow: '0 6px 14px rgba(15,23,42,0.03)',
          }}
        >
          <MessagePrimitive.Parts components={markdownPartComponents} />
        </Paper>
      </Box>
    </MessagePrimitive.Root>
  );
}

function MarkdownMessageText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      containerProps={{
        style: {
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          fontSize: '0.84rem',
          lineHeight: 1.65,
        },
      }}
    />
  );
}