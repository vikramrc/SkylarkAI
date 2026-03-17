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
      setConversations(response?.conversations || []);
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
  };

  const handleSelectConversation = async (conversation: any) => {
    setCurrentConversation(conversation);
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setChatInstanceKey((k) => k + 1);
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
            <button
              onClick={onToggleUI}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Classic View</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                className="p-1.5 bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              >
                <TbLanguage className="w-5 h-5" />
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-100 rounded-md shadow-lg z-30">
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => handleSelectLanguage('en')}>English</button>
                  <button className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => handleSelectLanguage('ja')}>日本語</button>
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
          onTogglePin={() => {}}
          onDelete={() => {}}
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
