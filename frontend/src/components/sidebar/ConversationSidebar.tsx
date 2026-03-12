import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@/types/chat';

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  userEmail: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

export default function ConversationSidebar({
  conversations,
  activeId,
  loading,
  userEmail,
  onNewChat,
  onSelectConversation,
  onTogglePin,
  onDeleteConversation,
}: ConversationSidebarProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filteredConversations = useMemo<Conversation[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...conversations].sort(
      (left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt),
    );

    if (!normalizedQuery) {
      return sorted;
    }

    return sorted.filter((conversation) => {
      const haystack = `${conversation.title} ${conversation.preview}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [conversations, query]);

  const pinned = filteredConversations.filter((conversation: Conversation) => conversation.isPinned);
  const recent = filteredConversations.filter((conversation: Conversation) => !conversation.isPinned);
  const userInitial = (userEmail?.trim().charAt(0) ?? 'S').toUpperCase();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack spacing={1.5} sx={{ p: { xs: 1.25, sm: 1.5 } }}>
        <Stack spacing={0.5}>
          <Typography
            sx={{
              fontFamily: '"Zen Dots", "Inter", sans-serif',
              fontSize: '0.78rem',
              lineHeight: 1.2,
              letterSpacing: '0.05em',
            }}
          >
            SEIKAIZEN AI
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('app.subtitle')}
          </Typography>
          <Typography variant="overline" color="primary.main" fontWeight={700} sx={{ letterSpacing: '0.08em' }}>
            {t('sidebar.recent')}
          </Typography>
        </Stack>

        <Button
          variant="contained"
          onClick={onNewChat}
          sx={{
            minHeight: 34,
            justifyContent: 'center',
            borderRadius: 1.25,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: '0.72rem',
          }}
        >
          {t('actions.newChat')}
        </Button>

        <TextField
          size="small"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setQuery(event.target.value)
          }
          placeholder={t('sidebar.searchPlaceholder')}
        />
      </Stack>

      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.75, py: 1, minHeight: 0 }}>
        {loading ? (
          <Typography variant="body2" color="text.secondary" px={1}>
            {t('sidebar.loading')}
          </Typography>
        ) : filteredConversations.length === 0 ? (
          <Typography variant="body2" color="text.secondary" px={1}>
            {t('sidebar.empty')}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {pinned.length > 0 ? (
              <ConversationSection
                title={t('sidebar.pinned')}
                items={pinned}
                activeId={activeId}
                locale={i18n.language}
                onSelectConversation={onSelectConversation}
                onTogglePin={onTogglePin}
                onDeleteConversation={setPendingDeleteId}
              />
            ) : null}

            <ConversationSection
              title={t('sidebar.recent')}
              items={recent}
              activeId={activeId}
                locale={i18n.language}
              onSelectConversation={onSelectConversation}
              onTogglePin={onTogglePin}
              onDeleteConversation={setPendingDeleteId}
            />
          </Stack>
        )}
      </Box>

      <Divider />
      <Box
        sx={{
          p: { xs: 1.25, sm: 1.5 },
          backgroundColor: 'rgba(255,255,255,0.42)',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1.25,
              display: 'grid',
              placeItems: 'center',
              color: 'primary.main',
              fontWeight: 700,
              backgroundColor: 'rgba(255,255,255,0.72)',
              border: '1px solid rgba(15,23,42,0.10)',
              flexShrink: 0,
            }}
          >
            {userInitial}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {t('sidebar.userLabel')}
            </Typography>
            <Typography
              variant="caption"
              fontWeight={600}
              title={userEmail ?? undefined}
              sx={{ overflowWrap: 'anywhere' }}
            >
              {userEmail ?? '—'}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Dialog open={Boolean(pendingDeleteId)} onClose={() => setPendingDeleteId(null)}>
        <DialogTitle>{t('sidebar.deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('sidebar.deleteBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDeleteId(null)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            onClick={() => {
              if (!pendingDeleteId) return;
              onDeleteConversation(pendingDeleteId);
              setPendingDeleteId(null);
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface ConversationSectionProps {
  title: string;
  items: Conversation[];
  activeId: string | null;
  locale: string;
  onSelectConversation: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

function ConversationSection({
  title,
  items,
  activeId,
  locale,
  onSelectConversation,
  onTogglePin,
  onDeleteConversation,
}: ConversationSectionProps) {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ px: 0.75, display: 'block', mb: 0.75 }}>
        {title}
      </Typography>
      <List dense disablePadding sx={{ display: 'grid', gap: 0.5 }}>
        {items.map((conversation) => (
          <ListItemButton
            key={conversation.id}
            selected={conversation.id === activeId}
            onClick={() => onSelectConversation(conversation.id)}
            sx={{
              mb: 0,
              px: 1,
              py: 0.9,
              borderRadius: 1.5,
              alignItems: { xs: 'stretch', sm: 'flex-start' },
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 0.75,
              border: '1px solid rgba(15,23,42,0.08)',
              backgroundColor:
                conversation.id === activeId ? alpha('#ffffff', 0.98) : alpha('#ffffff', 0.36),
              boxShadow:
                conversation.id === activeId
                  ? '0 6px 16px rgba(15,23,42,0.04)'
                  : 'none',
              '&:hover': {
                backgroundColor: alpha('#ffffff', 0.72),
              },
              '&.Mui-selected': {
                backgroundColor: '#fff',
              },
            }}
          >
            <Box sx={{ my: 0, width: '100%', minWidth: 0 }}>
              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0, pr: 1 }}>
                  {conversation.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatConversationDate(conversation.updatedAt, locale)}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.4, display: 'block' }} noWrap>
                {conversation.preview}
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ width: { xs: '100%', sm: 'auto' }, justifyContent: 'flex-end', pl: { sm: 0.25 } }}
            >
              <Button
                size="small"
                variant={conversation.isPinned ? 'contained' : 'text'}
                sx={{ minHeight: 24, minWidth: 0, px: 0.85, borderRadius: 1, fontSize: '0.68rem', boxShadow: 'none' }}
                onClick={(event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  onTogglePin(conversation.id);
                }}
              >
                {conversation.isPinned ? t('actions.unpin') : t('actions.pin')}
              </Button>
              <Button
                color="error"
                size="small"
                sx={{ minHeight: 24, minWidth: 0, px: 0.85, borderRadius: 1, fontSize: '0.68rem' }}
                onClick={(event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  onDeleteConversation(conversation.id);
                }}
              >
                {t('common.deleteShort')}
              </Button>
            </Stack>
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

function formatConversationDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}