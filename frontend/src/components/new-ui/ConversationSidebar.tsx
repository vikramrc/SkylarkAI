import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Pin, Trash2, History, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfirmationModal from './ConfirmationModal';

interface ConversationSidebarProps {
  conversations: any[];
  currentConversation: any | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectConversation: (conversation: any) => void;
  onNewChat: () => void;
  onTogglePin: (conversationId: string, isPinned: boolean) => void;
  onDelete: (conversationId: string) => void;
  loading: boolean;
  userEmail: string | null;
}

const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  currentConversation,
  isCollapsed,
  onToggleCollapse,
  onSelectConversation,
  onNewChat,
  onTogglePin,
  onDelete,
  loading,
  userEmail,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);

  // Filter conversations based on search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter((conv) => {
      const userQuery = (conv.userQuery || '').toLowerCase();
      const resolvedQuery = (conv.resolvedQuery || '').toLowerCase();
      const normalizedRequest = (conv.normalizedRequest || '').toLowerCase();
      return (
        userQuery.includes(query) ||
        resolvedQuery.includes(query) ||
        normalizedRequest.includes(query)
      );
    });
  }, [conversations, searchQuery]);

  const pinnedConversations = filteredConversations.filter((conv) => conv.isPinned);
  const recentConversations = filteredConversations.filter((conv) => !conv.isPinned);

  if (isCollapsed) {
    return (
      <div className="w-16 bg-gray-50 border-r border-gray-200 flex flex-col items-center py-4 gap-4 flex-shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-gray-200 text-gray-600 transition-colors"
          title="Expand sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          onClick={onNewChat}
          className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors"
          title="New Chat"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white/60 backdrop-blur-xl border-r border-white/20 flex flex-col flex-shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-gray-100/50 flex items-center justify-between flex-shrink-0">
        <h2 className="font-medium text-gray-900">{t('app.conversations')}</h2>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-600 transition-colors"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* New Chat Button */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-primary-200 text-primary-700 bg-white hover:bg-primary-50 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>{t('sidebar.new_chat', 'New Chat')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-4 pb-3 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('sidebar.search_placeholder', 'Search chats...') as string}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors bg-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="spinner w-6 h-6"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pinned Conversations */}
            {pinnedConversations.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  {t('app.pinned')}
                </h3>
                <div className="space-y-2">
                  {pinnedConversations.map((conversation) => (
                    <ConversationItem
                      key={conversation.conversationId}
                      conversation={conversation}
                      isActive={currentConversation?.conversationId === conversation.conversationId}
                      onSelect={onSelectConversation}
                      onTogglePin={onTogglePin}
                      onDelete={(id: string) => setConversationToDelete(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Conversations */}
            {recentConversations.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  {t('app.recent')}
                </h3>
                <div className="space-y-2">
                  {recentConversations.map((conversation) => (
                    <ConversationItem
                      key={conversation.conversationId}
                      conversation={conversation}
                      isActive={currentConversation?.conversationId === conversation.conversationId}
                      onSelect={onSelectConversation}
                      onTogglePin={onTogglePin}
                      onDelete={(id: string) => setConversationToDelete(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {filteredConversations.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium mb-1">
                  {searchQuery ? 'No conversations found' : t('app.no_conversations')}
                </p>
                {searchQuery && (
                  <p className="text-xs text-gray-400">Try a different search term</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      <ConfirmationModal
        isOpen={!!conversationToDelete}
        onClose={() => setConversationToDelete(null)}
        onConfirm={() => {
          if (conversationToDelete) {
            onDelete(conversationToDelete);
          }
        }}
        title={t('sidebar.delete_conversation_title', 'Delete Conversation')}
        message={t('sidebar.delete_conversation_message', 'Are you sure you want to delete this conversation? This action cannot be undone.')}
        confirmLabel={t('common.delete', 'Delete')}
        isDangerous={true}
      />
    </div>
  );
};

// Conversation Item Component
function ConversationItem({ conversation, isActive, onSelect, onTogglePin, onDelete }: any) {
  const { t } = useTranslation();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Number(now) - Number(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('time.just_now');
    if (diffMins < 60) return t('time.minutes_ago', { count: diffMins });
    if (diffHours < 24) return t('time.hours_ago', { count: diffHours });
    if (diffDays < 7) return t('time.days_ago', { count: diffDays });
    return date.toLocaleDateString();
  };

  const normalizedText =
    conversation.resolvedQuery ||
    conversation.normalizedRequest ||
    conversation.generatedQuery?.normalized ||
    conversation.userQuery ||
    '';
  const resultsCount =
    conversation?.executionMetadata?.resultCount ??
    ((Array.isArray(conversation?.results) ? conversation.results.length : 0) || 0);

  const tooltip = `${conversation.userQuery}\n${t('app.status')}: ${conversation.status}\n${t(
    'app.results_label'
  )}: ${resultsCount}`;

  return (
    <div
      className={`p-3 rounded-xl border transition-all duration-200 group relative ${
        isActive
          ? 'bg-white border-primary-100 shadow-md shadow-primary-500/5'
          : 'bg-transparent border-transparent hover:bg-white/60 hover:border-gray-100 hover:shadow-sm'
      }`}
      onClick={() => onSelect(conversation)}
      title={tooltip}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate" title={conversation.userQuery}>
            {conversation.userQuery}
          </p>
          <p className="text-xs text-gray-500 mt-1">{formatDate(conversation.createdAt)}</p>
        </div>
        <div className="flex items-center space-x-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(conversation.conversationId, conversation.isPinned);
            }}
            className={`p-1 rounded hover:bg-gray-200 transition-colors ${
              conversation.isPinned ? 'text-primary-600' : 'text-gray-400'
            }`}
          >
            <Pin className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(conversation.conversationId);
            }}
            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            conversation.status === 'completed'
              ? 'bg-green-100 text-green-700'
              : conversation.status === 'error'
              ? 'bg-red-100 text-red-700'
              : conversation.status === 'ambiguous' || conversation.status === 'disambiguating'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-gray-100 text-gray-700'
          }`}
        >
          {conversation.status === 'completed'
            ? t('status.completed')
            : conversation.status === 'error'
            ? t('status.error')
            : conversation.status === 'ambiguous' || conversation.status === 'disambiguating'
            ? t('status.hitl_disambiguation')
            : t('status.processing')}
        </span>
        <span className="text-xs text-gray-500">
          {resultsCount} {t('app.results_label')}
        </span>
      </div>
    </div>
  );
}

export default ConversationSidebar;

