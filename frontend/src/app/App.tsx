import React, { useEffect, useRef, useState } from 'react';
import { Zap, History, Pin, Trash2, ChevronDown, ChevronRight, ArrowLeft, LogOut, LayoutGrid } from 'lucide-react';
import ChatInterface from '@/components/ChatInterface';
import RequestResponse from '@/components/RequestResponse';
import DisambiguationFlow from '@/components/DisambiguationFlow';
import HitlSummary from '@/components/HitlSummary';
import NewChatLayoutV2 from '@/components/new-ui/NewChatLayoutV2';
import apiService from '@/services/api.service';
import { useTranslation } from 'react-i18next';
import { TbLanguage } from 'react-icons/tb';
import { authService } from '@/services/auth.service';
import { notifyUnauthorized } from '@/services/auth.events';

const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversation, setCurrentConversation] = useState<any|null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [phoenixUseStream, setPhoenixUseStream] = useState(false);
  const autoHydrateTopOnOpenRef = useRef(false);
  const [hydrating, setHydrating] = useState(false);
  const [useNewUI, setUseNewUI] = useState(true);

  const toggleLang = () => {
    const next = i18n.language === 'ja' ? 'en' : 'ja';
    i18n.changeLanguage(next);
    try { localStorage.setItem('language', next); } catch {}
  };

  useEffect(() => { loadConversations(); }, []);

  const loadConversations = async () => {
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    const cutoffTs = Date.now() - FORTY_EIGHT_HOURS_MS;
    const pageSize = 100;
    let page = 1;
    let all: any[] = [];
    let streamingFlag = false;
    try {
      setLoading(true);
      while (true) {
        const response = await apiService.getConversations({ page, pageSize });
        const items = response?.conversations || [];
        if (page === 1 && response) streamingFlag = !!response.phoenixUseStream;
        if (items.length === 0) break;
        all.push(...items);
        const last = items[items.length - 1];
        const lastUpdated = last?.updatedAt ? new Date(last.updatedAt).getTime() : 0;
        const reachedOldItems = lastUpdated > 0 && lastUpdated < cutoffTs;
        const isLastPage = items.length < pageSize || (response?.total && (page * pageSize) >= response.total);
        if (reachedOldItems || isLastPage) break;
        page += 1;
      }
      const filtered = all.filter(c => { const ts = c?.createdAt ? new Date(c.createdAt).getTime() : 0; return ts >= cutoffTs; });
      const map = new Map();
      for (const c of filtered) { if (c?.conversationId && !map.has(c.conversationId)) map.set(c.conversationId, c); }
      const list = Array.from(map.values()).sort((a: any, b: any) => new Date(b.createdAt) as any - (new Date(a.createdAt) as any));
      setConversations(list);
      if (autoHydrateTopOnOpenRef.current && list.length > 0) {
        setHydrating(true);
        try {
          const top = await apiService.getConversation(list[0].conversationId);
          setCurrentConversation(top || list[0]);
        } catch (e) {
          console.error('Failed to auto-hydrate top conversation:', e);
          setCurrentConversation(list[0]);
        } finally {
          autoHydrateTopOnOpenRef.current = false;
          setHydrating(false);
        }
      }
      setPhoenixUseStream(streamingFlag);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(t('app.error_history'));
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = (conversation: any) => {
    setCurrentConversation(conversation);
    setConversations(prev => [conversation, ...prev]);
  };

  const handleConversationUpdate = (updatedConversation: any) => {
    setCurrentConversation(updatedConversation);
    setConversations(prev => prev.map(conv => conv.conversationId === updatedConversation.conversationId ? updatedConversation : conv));
  };

  const handleTogglePin = async (conversationId: string, isPinned: boolean) => {
    try {
      await apiService.togglePin(conversationId, !isPinned);
      setConversations(prev => prev.map(conv => conv.conversationId === conversationId ? { ...conv, isPinned: !isPinned } : conv));
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!confirm(t('app.delete_confirm') as string)) return;
    try {
      await apiService.deleteConversation(conversationId);
      setConversations(prev => prev.filter(conv => conv.conversationId !== conversationId));
      if (currentConversation?.conversationId === conversationId) setCurrentConversation(null);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleSelectConversation = async (conversation: any) => {
    setHydrating(true);
    try {
      const full = await apiService.getConversation(conversation.conversationId);
      setCurrentConversation(full || conversation);
    } catch (err) {
      console.error('Failed to load full conversation:', err);
      setCurrentConversation(conversation);
    } finally { setHydrating(false); }
  };

  const pinnedConversations = conversations.filter(conv => conv.isPinned);
  const recentConversations = conversations.filter(conv => !conv.isPinned);

  // Session remaining indicator + user email
  const [remaining, setRemaining] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const fetchRemaining = async () => {
      try {
        const r = await authService.check();
        if (!mounted) return;
        if (r?.authenticated) {
          if (typeof r?.expiresIn === 'number') setRemaining(r.expiresIn);
          if (r?.user?.email) setUserEmail(r.user.email);
        }
      } catch (e) {
        // ignore
      }
    };
    fetchRemaining();
    const id = setInterval(fetchRemaining, 60 * 1000);
    return () => { mounted = false; clearInterval(id); };
  }, []);
  const renderRemaining = () => {
    if (remaining == null) return '—';
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `${mins}m ${secs}s`;
  };

  // If new UI is enabled, render the new layout
  if (useNewUI) {
    return (
      <>
        <div className="background-container" aria-hidden>
          <svg className="background-svg" viewBox="0 0 1450 678" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0h1440v807H0V0Z" fill="url(#a)"></path>
            <path d="M0 1h1440v-2H0v2Z" fill="#F0F1F7" mask="url(#b)"></path>
            <defs>
              <radialGradient id="a" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(340.49937606 556.463845 -1058.73086457 647.8357975 400.5 241.266)">
                <stop stopColor="#E5CCFF"></stop>
                <stop offset=".305881" stopColor="#CCF"></stop>
                <stop offset=".601058" stopColor="#FFF6CC"></stop>
                <stop offset="1" stopColor="#FAFAFC" stopOpacity="0"></stop>
              </radialGradient>
            </defs>
          </svg>
        </div>
        <NewChatLayoutV2
          onToggleUI={() => setUseNewUI(false)}
          userEmail={userEmail}
        />
      </>
    );
  }

  // Original UI
  return (
    <>
      <div className="background-container" aria-hidden>
        <svg className="background-svg" viewBox="0 0 1450 678" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0h1440v807H0V0Z" fill="url(#a)"></path>
          <path d="M0 1h1440v-2H0v2Z" fill="#F0F1F7" mask="url(#b)"></path>
          <defs>
            <radialGradient id="a" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(340.49937606 556.463845 -1058.73086457 647.8357975 400.5 241.266)">
              <stop stopColor="#E5CCFF"></stop>
              <stop offset=".305881" stopColor="#CCF"></stop>
              <stop offset=".601058" stopColor="#FFF6CC"></stop>
              <stop offset="1" stopColor="#FAFAFC" stopOpacity="0"></stop>
            </radialGradient>
          </defs>
        </svg>
      </div>

      <div className="min-h-screen">
        <header className="bg-white/80 backdrop-blur border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: '"Zen Dots", Roboto, Inter, sans-serif' }}>{t('app.title')}</h1>
                <p className="hidden text-sm text-gray-600">{t('app.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* metrics moved to bottom-left global panel */}
              <span className="hidden sm:inline-block w-px h-6 bg-gray-200" aria-hidden></span>
              <button onClick={() => { setIsHistoryExpanded(prev => { const next = !prev; if (next) { autoHydrateTopOnOpenRef.current = true; loadConversations(); } return next; }); }} className="flex items-center space-x-2 px-3 py-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 transition-colors">
                <History className="w-4 h-4" />
                <span>{t('app.history')}</span>
                {isHistoryExpanded ? (<ChevronDown className="w-4 h-4" />) : (<ChevronRight className="w-4 h-4" />)}
              </button>
              <button
                onClick={() => setUseNewUI(true)}
                title="Switch to New UI"
                className="flex items-center space-x-2 px-3 py-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 transition-colors"
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">New UI</span>
              </button>
              <button onClick={toggleLang} title={t('app.language_tooltip') as string} className="p-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
                <TbLanguage className="w-5 h-5" />
              </button>
              <button onClick={async () => { try { await authService.logout(); } finally { notifyUnauthorized(); } }} title="Logout" className="p-2 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-lg border border-gray-300 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <div className="flex">
          {isHistoryExpanded && (
            <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-medium text-gray-900">{t('app.conversations')}</h2>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {loading ? (
                  <div className="flex items-center justify-center p-8"><div className="spinner w-6 h-6"></div></div>
                ) : (
                  <div className="p-4 space-y-4">
                    {pinnedConversations.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{t('app.pinned')}</h3>
                        <div className="space-y-2">
                          {pinnedConversations.map((conversation, idx) => (
                            <ConversationItem key={conversation.conversationId} index={idx} conversation={conversation} isActive={currentConversation?.conversationId === conversation.conversationId} onSelect={handleSelectConversation} onTogglePin={handleTogglePin} onDelete={handleDeleteConversation} />
                          ))}
                        </div>
                      </div>
                    )}

                    {recentConversations.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{t('app.recent')}</h3>
                        <div className="space-y-2">
                          {recentConversations.map((conversation, idx) => (
                            <ConversationItem key={conversation.conversationId} index={idx} conversation={conversation} isActive={currentConversation?.conversationId === conversation.conversationId} onSelect={handleSelectConversation} onTogglePin={handleTogglePin} onDelete={handleDeleteConversation} />
                          ))}
                        </div>
                      </div>
                    )}

                    {conversations.length === 0 && !loading && (
                      <div className="text-center py-8 text-gray-500">
                        <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t('app.no_conversations')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col">
            {currentConversation ? (
              <>
                <div className="bg-gray-50 border-b border-gray-200 p-2 pl-4 flex items-center justify-between">
                  <button className="flex items-center space-x-2 px-3 py-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 text-sm" onClick={() => { setCurrentConversation(null); setIsHistoryExpanded(false); }}>
                    <ArrowLeft className="w-4 h-4" />
                    <span>{t('app.back_to_chat')}</span>
                  </button>
                  {hydrating && (<div className="flex items-center gap-2 text-gray-500 text-sm pr-4"><div className="spinner w-4 h-4" /><span>{t('app.loading')}</span></div>)}
                </div>
                {(() => {
                  const isAmbiguous = currentConversation?.status === 'ambiguous' || currentConversation?.status === 'disambiguating';
                  const hasLog = !!currentConversation?.disambiguationLog;
                  const hasDisambiguationData = (currentConversation?.clarifyingQuestions?.length > 0) || (currentConversation?.assumptions?.length > 0) || hasLog;
                  if (!isAmbiguous) {
                    return (
                      <RequestResponse conversation={currentConversation} onUpdate={handleConversationUpdate} onOpenRelated={async (relatedId) => { try { const related = await apiService.getConversation(relatedId); if (related) setCurrentConversation(related); } catch (err) { console.error('Failed to open related (HITL) conversation:', err); } }} />
                    );
                  }
                  if (isAmbiguous && !hasDisambiguationData) {
                    return (
                      <DisambiguationFlow conversation={currentConversation} onComplete={(result) => setCurrentConversation(result)} onCancel={() => setCurrentConversation(null)} onUpdate={handleConversationUpdate} readOnly={currentConversation?.status !== 'ambiguous'} useStreaming={phoenixUseStream} />
                    );
                  }
                  return <HitlSummary conversation={currentConversation} />;
                })()}
              </>
            ) : (
              <ChatInterface onNewConversation={handleNewConversation} onConversationUpdate={handleConversationUpdate} phoenixUseStream={phoenixUseStream} />
            )}
          </div>
        </div>

        {error && (
          <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
            <p>{error}</p>
            <button onClick={() => setError(null)} className="ml-2 text-red-200 hover:text-white">×</button>
          </div>
        )}
      </div>

    </>
  );
};

export default App;

function ConversationItem({ conversation, isActive, onSelect, onTogglePin, onDelete, index }: any) {
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

  const normalizedText = conversation.resolvedQuery || conversation.normalizedRequest || conversation.generatedQuery?.normalized || conversation.userQuery || '';
  const resultsCount = (conversation?.executionMetadata?.resultCount ?? (Array.isArray(conversation?.results) ? conversation.results.length : 0)) || 0;

  const tooltip = `${conversation.userQuery}\n${t('app.status')}: ${conversation.status}\n${t('app.results_label')}: ${resultsCount}`;

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
        isActive
          ? 'bg-primary-50 border-primary-200'
          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
      }`}
      onClick={() => onSelect(conversation)}
      title={tooltip}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate" title={conversation.userQuery}>
            {conversation.userQuery}
          </p>
          {normalizedText && normalizedText !== conversation.userQuery && (
            <p className="text-xs text-gray-600 truncate" title={normalizedText}>
              <span className="text-gray-500">{t('app.normalized')}:</span> {normalizedText}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            {formatDate(conversation.createdAt)}
          </p>
        </div>
        <div className="flex items-center space-x-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(conversation.conversationId, conversation.isPinned);
            }}
            className={`p-1 rounded hover:bg-gray-200 ${
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
            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
            conversation.status === 'completed' ? 'bg-green-100 text-green-700' :
            conversation.status === 'error' ? 'bg-red-100 text-red-700' :
            conversation.status === 'ambiguous' || conversation.status === 'disambiguating' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {conversation.status === 'completed' ? t('status.completed') :
             conversation.status === 'error' ? t('status.error') :
             conversation.status === 'ambiguous' || conversation.status === 'disambiguating' ? t('status.hitl_disambiguation') :
             t('status.processing')}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {resultsCount} {t('app.results_label')}
        </span>
      </div>
    </div>
  );
}
