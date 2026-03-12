import React, { useState, useEffect } from 'react';
import { Zap, LogOut, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TbLanguage } from 'react-icons/tb';
import { authService } from '@/services/auth.service';
import { notifyUnauthorized } from '@/services/auth.events';
import ConversationSidebar from './ConversationSidebar';
import ChatView from './ChatView';
import apiService from '@/services/api.service';

interface NewChatLayoutProps {
  onToggleUI: () => void;
  phoenixUseStream: boolean;
}

const NewChatLayout: React.FC<NewChatLayoutProps> = ({ onToggleUI, phoenixUseStream }) => {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversation, setCurrentConversation] = useState<any | null>(null);
  const [chatInstanceKey, setChatInstanceKey] = useState<number>(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [langOpen, setLangOpen] = useState(false);
  const handleSelectLanguage = (lng: 'en' | 'ja' | 'zh' | 'ko') => {
    i18n.changeLanguage(lng);
    try {
      localStorage.setItem('language', lng);
    } catch {}
    setLangOpen(false);
  };

  useEffect(() => {
    loadConversations();
  }, []);

  // Session remaining indicator + user email
  useEffect(() => {
    let mounted = true;
    const fetchRemaining = async () => {
      try {
        const r = await authService.check();
        if (!mounted) return;
        if (r?.authenticated) {
          if (r?.user?.email) setUserEmail(r.user.email);
        }
      } catch (e) {
        // ignore
      }
    };
    fetchRemaining();
    const id = setInterval(fetchRemaining, 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);


  const loadConversations = async () => {
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    const cutoffTs = Date.now() - FORTY_EIGHT_HOURS_MS;
    const pageSize = 100;
    let page = 1;
    let all: any[] = [];
    try {
      setLoading(true);
      while (true) {
        const response = await apiService.getConversations({ page, pageSize });
        const items = response?.conversations || [];
        if (items.length === 0) break;
        all.push(...items);
        const last = items[items.length - 1];
        const lastUpdated = last?.updatedAt ? new Date(last.updatedAt).getTime() : 0;
        const reachedOldItems = lastUpdated > 0 && lastUpdated < cutoffTs;
        const isLastPage =
          items.length < pageSize || (response?.total && page * pageSize >= response.total);
        if (reachedOldItems || isLastPage) break;
        page += 1;
      }
      const filtered = all.filter((c) => {
        const ts = c?.createdAt ? new Date(c.createdAt).getTime() : 0;
        return ts >= cutoffTs;
      });
      const map = new Map();
      for (const c of filtered) {
        if (c?.conversationId && !map.has(c.conversationId)) map.set(c.conversationId, c);
      }
      const list = Array.from(map.values()).sort(
        (a: any, b: any) => (new Date(b.createdAt) as any) - (new Date(a.createdAt) as any)
      );
      setConversations(list);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = (conversation: any) => {
    setCurrentConversation(conversation);
    setConversations((prev) => [conversation, ...prev]);
  };

  const handleConversationUpdate = (updatedConversation: any) => {
    setCurrentConversation(updatedConversation);
    setConversations((prev) =>
      prev.map((conv) =>
        conv.conversationId === updatedConversation.conversationId ? updatedConversation : conv
      )
    );
  };

  const handleSelectConversation = async (conversation: any) => {
    try {
      const full = await apiService.getConversation(conversation.conversationId);
      setCurrentConversation(full || conversation);
    } catch (err) {
      console.error('Failed to load full conversation:', err);
      setCurrentConversation(conversation);
    }
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setChatInstanceKey((k) => k + 1); // force ChatView remount to fully reset local state
  };

  const handleTogglePin = async (conversationId: string, isPinned: boolean) => {
    try {
      await apiService.togglePin(conversationId, !isPinned);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.conversationId === conversationId ? { ...conv, isPinned: !isPinned } : conv
        )
      );
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    // Confirmation is handled in ConversationSidebar
    try {
      await apiService.deleteConversation(conversationId);
      setConversations((prev) => prev.filter((conv) => conv.conversationId !== conversationId));
      if (currentConversation?.conversationId === conversationId) setCurrentConversation(null);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white/70 backdrop-blur-md border-b border-white/20 shadow-sm px-6 py-4 flex-shrink-0 z-20 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <h1
                className="text-2xl font-bold text-gray-900"
                style={{ fontFamily: '"Zen Dots", "Outfit", sans-serif' }}
              >
                {t('app.title')}
              </h1>
<p className="hidden text-sm text-gray-600">{t('app.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onToggleUI}
              title="Switch to Old UI"
              className="hidden flex items-center space-x-2 px-3 py-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">Old UI</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                title={t('app.language_tooltip') as string}
                className="p-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <TbLanguage className="w-5 h-5" />
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => handleSelectLanguage('en')}>{t('app.language_en')}</button>
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => handleSelectLanguage('ja')}>{t('app.language_ja')}</button>
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => handleSelectLanguage('zh')}>{t('app.language_zh')}</button>
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={() => handleSelectLanguage('ko')}>{t('app.language_ko')}</button>
                </div>
              )}
            </div>
            <button
              onClick={async () => {
                try {
                  await authService.logout();
                } finally {
                  notifyUnauthorized();
                }
              }}
              title="Logout"
              className="p-2 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-lg border border-gray-300 transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        <ConversationSidebar
          conversations={conversations}
          currentConversation={currentConversation}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          onTogglePin={handleTogglePin}
          onDelete={handleDeleteConversation}
          loading={loading}
          userEmail={userEmail}
        />
        <ChatView
          key={chatInstanceKey}
          currentConversation={currentConversation}
          onNewConversation={handleNewConversation}
          onConversationUpdate={handleConversationUpdate}
          phoenixUseStream={phoenixUseStream}
        />
      </div>

    </div>
  );
};

export default NewChatLayout;

