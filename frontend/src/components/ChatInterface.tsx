import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, MessageSquare, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiService from '@/services/api.service';
import StreamingProgress from '@/components/StreamingProgress';
import DisambiguationFlow from '@/components/DisambiguationFlow';

export type ChatInterfaceProps = {
  onNewConversation: (c: any) => void;
  onConversationUpdate?: (c: any) => void;
  phoenixUseStream?: boolean;
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ onNewConversation, onConversationUpdate, phoenixUseStream=false }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [currentConversation, setCurrentConversation] = useState<any>(null);
  const [subtleStatus, setSubtleStatus] = useState('');
  const [heartbeatCount, setHeartbeatCount] = useState(0);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number|null>(null);
  const [activityLevel, setActivityLevel] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusMessageKey, setStatusMessageKey] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [streamStartTime, setStreamStartTime] = useState<number>(0);
  const eventSourceRef = useRef<EventSource|null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const useStreaming = !!phoenixUseStream;

  useEffect(() => {
    const cleanup = () => {
      if (eventSourceRef.current) {
        try { eventSourceRef.current.close(); } catch {}
        eventSourceRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    window.addEventListener('beforeunload', cleanup);
    return () => { cleanup(); window.removeEventListener('beforeunload', cleanup); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setSubtleStatus('');
    setHeartbeatCount(0);
    setStatusMessage('');
    setStatusMessageKey('');
    setElapsedSeconds(0);
    setTokenCount(0);

    // Start elapsed time timer
    const startTime = Date.now();
    setStreamStartTime(startTime);

    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Start timer for elapsed seconds
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    if (!useStreaming) {
      try {
        const result = await apiService.submitQuery(query.trim());
        if (result.status === 'ambiguous') {
          setCurrentConversation(result);
          onNewConversation?.(result);
        } else {
          onNewConversation(result);
          setQuery('');
        }
      } catch (err: any) {
        console.error('Query submission failed:', err);
        setError(err?.message || t('chat.error_generic'));
      } finally {
        setIsLoading(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
      return;
    }

    if (eventSourceRef.current) { try { eventSourceRef.current.close(); } catch {} eventSourceRef.current = null; }

    const es = apiService.createEventSource(`/phoenix-openai/query/stream?userQuery=${encodeURIComponent(query.trim())}`);
    eventSourceRef.current = es;

    let done = false;
    const close = () => {
      if (!done) {
        done = true;
        try { es.close(); } catch {}
        eventSourceRef.current = null;
        setIsLoading(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    es.addEventListener('status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        setSubtleStatus(data.stage || '');

        // Handle streaming status messages
        if (data.messageKey) {
          setStatusMessageKey(data.messageKey);
          setStatusMessage(''); // Clear direct message when using key
        } else if (data.message) {
          setStatusMessage(data.message);
          setStatusMessageKey(''); // Clear key when using direct message
        }

        // Update token count if provided
        if (typeof data.tokens === 'number') {
          setTokenCount(data.tokens);
        }
      } catch {}
    });

    es.addEventListener('heartbeat', (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data || '{}');
        setHeartbeatCount((prev) => prev + 1);
        setLastHeartbeatAt(Date.now());
        const score = typeof d.activityScore === 'number' ? d.activityScore : 0;
        const nextLevel = score >= 0.85 ? 4 : score >= 0.6 ? 3 : score >= 0.35 ? 2 : score > 0.05 ? 1 : 0;
        setActivityLevel(nextLevel);
      } catch {}
    });

    es.addEventListener('disambiguation', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        setCurrentConversation(data);
      } catch {}
    });

    es.addEventListener('result', async (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        try {
          const full = await apiService.getConversation(data.conversationId);
          onNewConversation(full || data);
        } catch {
          onNewConversation(data);
        }
        setQuery('');
      } catch {}
    });

    es.addEventListener('error', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        setError(data.message || t('chat.error_stream'));
      } catch {
        setError(t('chat.error_stream'));
      }
    });

    es.addEventListener('end', () => close());
  };

  const handleDisambiguationComplete = (result: any) => {
    setCurrentConversation(null);
    onNewConversation(result);
    setQuery('');
  };

  const handleDisambiguationCancel = () => setCurrentConversation(null);

  const handleSampleQuery = (sampleQuery: string) => setQuery(sampleQuery);

  const sampleQueries = (t('chat.sample_queries', { returnObjects: true }) as string[]) || [];

  if (currentConversation?.status === 'ambiguous') {
    return (
      <DisambiguationFlow
        conversation={currentConversation}
        onComplete={handleDisambiguationComplete}
        onCancel={handleDisambiguationCancel}
        onUpdate={(updated: any) => setCurrentConversation({ ...updated, status: 'ambiguous' })}
        useStreaming={useStreaming}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="max-w-3xl w-full text-center">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 rounded-full mb-5">
              <MessageSquare className="w-10 h-10 text-primary-600" />
            </div>
            <h2 className="text-3xl font-semibold text-gray-900 mb-3">{t('chat.welcome_title')}</h2>
            <p className="text-gray-600 text-base mb-10">{t('chat.welcome_body')}</p>
          </div>

          <div className="mb-8">
            <div className="flex items-center justify-center mb-5">
              <Lightbulb className="w-5 h-5 text-yellow-500 mr-2" />
              <span className="text-base font-medium text-gray-700">{t('chat.try_asking')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sampleQueries.map((sampleQuery, index) => (
                <button
                  key={index}
                  onClick={() => handleSampleQuery(sampleQuery)}
                  className="p-4 text-left bg-white border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors duration-200 text-base"
                  disabled={isLoading}
                >
                  "{sampleQuery}"
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center mb-8">
            <div className="flex-1 border-t border-gray-200" />
            <span className="px-4 text-sm text-gray-500">{t('chat.divider_or')}</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <form onSubmit={handleSubmit} className="w-full">
            <div className="relative">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('chat.placeholder')}
                className="w-full px-5 py-4 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-base"
                rows={4}
                disabled={isLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as any); }
                }}
              />
              <button type="submit" disabled={!query.trim() || isLoading} className="absolute bottom-3 right-3 p-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200">
                {isLoading ? (<Loader2 className="w-5 h-5 animate-spin" />) : (<Send className="w-5 h-5" />)}
              </button>
            </div>

            <StreamingProgress
              isLoading={isLoading}
              useStreaming={useStreaming || Boolean(eventSourceRef.current)}
              subtleStatus={subtleStatus}
              heartbeatCount={heartbeatCount}
              activityLevel={activityLevel}
              statusMessage={statusMessage}
              statusMessageKey={statusMessageKey}
              elapsedSeconds={elapsedSeconds}
              tokenCount={tokenCount}
            />

            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>{t('chat.helper_send')}</span>
              <span>{query.length}/1000</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;

