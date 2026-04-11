import React, { useState, useEffect } from 'react';
import { LogOut, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TbLanguage } from 'react-icons/tb';
import { authService } from '@/services/auth.service';
import { notifyUnauthorized } from '@/services/auth.events';
import ConversationSidebar from './ConversationSidebar';
import ContinuousChatView from './ContinuousChatView';
import apiService from '@/services/api.service';

interface NewChatLayoutV2Props {
  onToggleUI: () => void;
  userEmail?: string | null;
}

const NewChatLayoutV2: React.FC<NewChatLayoutV2Props> = ({ onToggleUI, userEmail }) => {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversation, setCurrentConversation] = useState<any | null>(null);
  const [chatInstanceKey, setChatInstanceKey] = useState<number>(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const loadConversations = async () => {
    const pageSize = 50;
    try {
      setLoading(true);
      const response = await apiService.getConversations({ page: 1, pageSize });
      const items = response?.conversations || [];
      const map = new Map();
      for (const c of items) {
          const id = c.conversationId || c.id;
          if (id && !map.has(id)) map.set(id, c);
      }
      setConversations(Array.from(map.values()));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = (conversation: any) => {
    setCurrentConversation(conversation);
    setConversations((prev) => {
        const id = conversation.conversationId || conversation.id;
        if (prev.some(c => (c.conversationId || c.id) === id)) return prev;
        return [conversation, ...prev];
    });
  };

  const handleConversationUpdate = (updatedConversation: any) => {
    setCurrentConversation(updatedConversation);
    setConversations((prev) => prev.map(conv => {
        const cId = conv.conversationId || conv.id;
        const uId = updatedConversation.conversationId || updatedConversation.id;
        return cId === uId ? updatedConversation : conv;
    }));
  };

  const handleSelectConversation = async (conversation: any) => {
    setCurrentConversation(conversation);
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setChatInstanceKey((k) => k + 1);
  };

  const handleTogglePin = async (conversationId: string, isPinned: boolean) => {
    try {
      await apiService.togglePin(conversationId, !isPinned);
      setConversations((prev) =>
        prev.map((conv) => {
          const cId = conv.conversationId || conv.id;
          return cId === conversationId ? { ...conv, isPinned: !isPinned } : conv;
        })
      );
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await apiService.deleteConversation(conversationId);
      setConversations((prev) => prev.filter((conv) => (conv.conversationId || conv.id) !== conversationId));
      const currentId = currentConversation?.conversationId || currentConversation?.id;
      if (currentId === conversationId) setCurrentConversation(null);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50/40">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm px-6 py-4 flex-shrink-0 z-20 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h1
              className="text-2xl font-bold text-gray-900 tracking-tight"
              style={{ fontFamily: '"Zen Dots", Roboto, Inter, sans-serif' }}
            >
              {t('app.title')}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                className="p-1.5 bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors flex items-center gap-2 px-2.5"
                title={t('app.language_tooltip')}
              >
                <TbLanguage className="w-5 h-5" />
                <span className="text-xs font-semibold uppercase">{i18n.language}</span>
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-100 rounded-xl shadow-xl z-30 py-1 overflow-hidden animate-fade-in-up">
                  <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm font-medium transition-colors" onClick={() => handleSelectLanguage('en')}>English</button>
                  <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm font-medium transition-colors" onClick={() => handleSelectLanguage('ja')}>日本語</button>
                  <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm font-medium transition-colors" onClick={() => handleSelectLanguage('zh')}>中文</button>
                  <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm font-medium transition-colors" onClick={() => handleSelectLanguage('ko')}>한국어</button>
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
              className="p-1.5 bg-gray-50 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 rounded-lg transition-colors"
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
          userEmail={userEmail ?? null}
        />
        <div className="flex-1">
            <ContinuousChatView
              key={chatInstanceKey}
              currentConversation={currentConversation}
              onNewConversation={handleNewConversation}
              onConversationUpdate={handleConversationUpdate}
            />
        </div>
      </div>
    </div>
  );
};

export default NewChatLayoutV2;
