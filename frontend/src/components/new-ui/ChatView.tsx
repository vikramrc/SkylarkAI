import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, MessageSquare, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiService from '@/services/api.service';
import StreamingTimeline from './StreamingTimeline';
import InlineDisambiguation from './InlineDisambiguation';
import InlineResults from './InlineResults';

interface ChatViewProps {
  currentConversation: any | null;
  onNewConversation: (conversation: any) => void;
  onConversationUpdate: (conversation: any) => void;
  phoenixUseStream: boolean;
}

interface Message {
  id: string;
  type: 'user' | 'ai' | 'disambiguation' | 'results' | 'timeline';
  content: any;
  timestamp: Date;
}

const ChatView: React.FC<ChatViewProps> = ({
  currentConversation,
  onNewConversation,
  onConversationUpdate,
  phoenixUseStream,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [timelines, setTimelines] = useState<Record<string, any>>({});
  const currentTlIdRef = useRef<string | null>(null);
  const skipHydrationForConversationIdRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);

  // Sample queries for welcome screen (i18n)
  const sampleQueries = (t('chat.sample_queries', { returnObjects: true }) as unknown as string[]) || [];

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [query]);


  // Load conversation only when a different conversationId is selected from the sidebar.
  // Streaming updates for the same conversationId should NOT rebuild message history.
  useEffect(() => {
    if (!currentConversation) {
      setMessages([]);
      setIsProcessing(false);
      prevConversationIdRef.current = null;
      return;
    }

    const convId = currentConversation.conversationId;

    // Skip hydration if this change came from our own streaming event handlers
    if (skipHydrationForConversationIdRef.current === convId) {
      skipHydrationForConversationIdRef.current = null;
      return;
    }

    if (prevConversationIdRef.current !== convId) {
      loadConversationMessages(currentConversation);
      prevConversationIdRef.current = convId;
    }
  }, [currentConversation]);

  const loadConversationMessages = (conversation: any) => {
    const msgs: Message[] = [];

    // User message
    msgs.push({
      id: `user-${conversation.conversationId}`,
      type: 'user',
      content: conversation.userQuery,
      timestamp: new Date(conversation.createdAt),
    });

    // Check if disambiguation is needed
    if (
      conversation.status === 'ambiguous' ||
      conversation.status === 'disambiguating' ||
      conversation.clarifyingQuestions?.length > 0
    ) {
      msgs.push({
        id: `disambiguation-${conversation.conversationId}`,
        type: 'disambiguation',
        content: conversation,
        timestamp: new Date(conversation.updatedAt),
      });
    }

    // Results
    if (conversation.status === 'completed' && conversation.results) {
      msgs.push({
        id: `results-${conversation.conversationId}`,
        type: 'results',
        content: conversation,
        timestamp: new Date(conversation.updatedAt),
      });
    }

    setMessages(msgs);
  };

  const handleSubmit = async () => {
    if (!query.trim() || isProcessing) return;

    const userQuery = query.trim();
    setQuery('');
    setIsProcessing(true);

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userQuery,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Create a new timeline message for this run and keep its state keyed by tlId
    const tlId = `tl-${Date.now()}`;
    const timelineMessage: Message = {
      id: tlId,
      type: 'timeline',
      content: { id: tlId },
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, timelineMessage]);
    setTimelines((prev) => ({
      ...prev,
      [tlId]: { stage: 'ambiguity', message: t('status.analyzing'), messageKey: 'status.analyzing', startTime: Date.now() },
    }));
    currentTlIdRef.current = tlId;

    // On explicit user submit, scroll to (and slightly past) the bottom so the new timeline starts in view
    // BUT: if this is the first welcome screen (no prior messages), do not auto-scroll.
    const wasWelcome = messages.length === 0;
    if (!wasWelcome) {
      setTimeout(() => {
        const sc = scrollContainerRef.current;
        if (sc) {
          sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
          const extra = Math.ceil(sc.clientHeight * 0.9);
          sc.scrollBy({ top: extra, behavior: 'smooth' });
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          window.scrollBy({ top: Math.ceil(window.innerHeight * 0.95), behavior: 'smooth' });
        }
      }, 0);
    }

    try {
      if (phoenixUseStream) {
        await handleStreamingQuery(userQuery, tlId);
      } else {
        await handleNonStreamingQuery(userQuery, tlId);
      }
    } catch (error) {
      console.error('Failed to submit query:', error);
      setIsProcessing(false);
    }
  };

  const handleStreamingQuery = async (userQuery: string, tlId: string) => {
    const eventSource = apiService.createEventSource(
      `/phoenix/query/stream?userQuery=${encodeURIComponent(userQuery)}`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('status', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setTimelines((prev: any) => ({
          ...prev,
          [tlId]: {
            ...(prev?.[tlId] || { startTime: Date.now() }),
            stage: data.stage ?? prev?.[tlId]?.stage,
            message: data.message ?? '',
            messageKey: data.messageKey,
            activityLevel: data.activityLevel,
            tokenCount: data.tokenCount,
          },
        }));
      } catch (err) {
        console.error('Failed to parse status event:', err);
      }
    });

    eventSource.addEventListener('result', (e: any) => {
      try {
        const conversation = JSON.parse(e.data);
        // Allow parent to update without triggering hydration here
        skipHydrationForConversationIdRef.current = conversation.conversationId;
        onNewConversation(conversation);
        // Append results as a new message, do not rebuild history
        setMessages((prev) => [
          ...prev,
          {
            id: `results-${conversation.conversationId}-${Date.now()}`,
            type: 'results',
            content: conversation,
            timestamp: new Date(conversation.updatedAt ?? Date.now()),
          },
        ]);
        // Mark timeline as done to stop spinners in StreamingTimeline
        setTimelines((prev: any) => ({
          ...prev,
          [tlId]: {
            ...(prev?.[tlId] || { startTime: Date.now() }),
            stage: 'done',
            message: '',
            messageKey: undefined,
            activityLevel: 0,
            tokenCount: 0,
          },
        }));
        setIsProcessing(false);
        currentTlIdRef.current = null;
        eventSource.close();
      } catch (err) {
        console.error('Failed to parse result event:', err);
      }
    });

    eventSource.addEventListener('disambiguation', (e: any) => {
      try {
        const conversation = JSON.parse(e.data);
        skipHydrationForConversationIdRef.current = conversation.conversationId;
        onNewConversation(conversation);
        // Append disambiguation as a new message, do not rebuild history
        setMessages((prev) => [
          ...prev,
          {
            id: `disambiguation-${conversation.conversationId}-${Date.now()}`,
            type: 'disambiguation',
            content: conversation,
            timestamp: new Date(conversation.updatedAt ?? Date.now()),
          },
        ]);
        // Mark timeline as done to stop spinners in StreamingTimeline
        setTimelines((prev: any) => ({
          ...prev,
          [tlId]: {
            ...(prev?.[tlId] || { startTime: Date.now() }),
            stage: 'done',
            message: '',
            messageKey: undefined,
            activityLevel: 0,
            tokenCount: 0,
          },
        }));
        setIsProcessing(false);
        currentTlIdRef.current = null;
        eventSource.close();
      } catch (err) {
        console.error('Failed to parse disambiguation event:', err);
      }
    });

    eventSource.addEventListener('error', (e: any) => {
      console.error('EventSource error:', e);
      let text = 'streaming connection failed.';

      try {
        const parsed = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        text = parsed?.message ?? (typeof e.data === 'string' ? e.data : text);
      } catch {}
      // Feed the error into the timeline state for this run
      setTimelines((prev: any) => ({
        ...prev,
        [tlId]: {
          ...(prev?.[tlId] || { startTime: Date.now() }),
          stage: prev?.[tlId]?.stage ?? 'generation',
          message: `Error: ${text}`,
          messageKey: undefined,
          activityLevel: 0,
          tokenCount: 0,
        },
      }));
      setIsProcessing(false);
      currentTlIdRef.current = null;
      eventSource.close();
    });

    eventSource.addEventListener('end', () => {
      // Mark timeline as done to stop spinners in StreamingTimeline
      setTimelines((prev: any) => ({
        ...prev,
        [tlId]: {
          ...(prev?.[tlId] || { startTime: Date.now() }),
          stage: 'done',
          message: '',
          messageKey: undefined,
          activityLevel: 0,
          tokenCount: 0,
        },
      }));
      setIsProcessing(false);
      currentTlIdRef.current = null;
      eventSource.close();
    });
  };

  const handleNonStreamingQuery = async (userQuery: string, tlId: string) => {
    try {
      const conversation = await apiService.submitQuery(userQuery);
      // Allow parent to update without triggering hydration here
      skipHydrationForConversationIdRef.current = conversation.conversationId;
      onNewConversation(conversation);
      // Append results as a new message, do not rebuild history
      setMessages((prev) => [
        ...prev,
        {
          id: `results-${conversation.conversationId}-${Date.now()}`,
          type: 'results',
          content: conversation,
          timestamp: new Date(conversation.updatedAt ?? Date.now()),
        },
      ]);
    } finally {
      setIsProcessing(false);
      currentTlIdRef.current = null;
    }
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsProcessing(false);
    
    // Update timeline to show cancellation
    const tlId = currentTlIdRef.current;
    if (tlId) {
      setTimelines((prev) => ({
        ...prev,
        [tlId]: {
          ...prev[tlId],
          message: 'Request cancelled by user',
          messageKey: 'status.cancelled',
          // Keep the same stage so it appends to the current block
        }
      }));
    }

    currentTlIdRef.current = null;
    setNotification('Request cancelled');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSampleQueryClick = (sampleQuery: string) => {
    setQuery(sampleQuery);
    textareaRef.current?.focus();
  };

  // Show welcome screen if no messages
  const showWelcome = messages.length === 0 && !isProcessing;
  const showTextarea = !currentConversation || currentConversation.status !== 'completed';
  // After results/disambiguation append, auto-scroll and push up by ~70vh
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.type === 'results' || last.type === 'disambiguation') {
      const sc = scrollContainerRef.current;
      const extra = Math.ceil(window.innerHeight * 0.7);
      if (sc) {
        sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
        // Give the browser a tick to layout before extra scroll
        setTimeout(() => sc.scrollBy({ top: extra, behavior: 'smooth' }), 50);
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        setTimeout(() => window.scrollBy({ top: extra, behavior: 'smooth' }), 50);
      }
    }
  }, [messages]);

  const hasResults = messages.some((m) => m.type === 'results');


  return (
    <div className="flex-1 flex flex-col">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto" ref={scrollContainerRef} style={{ paddingBottom: (isProcessing || hasResults) ? '70vh' : undefined }}>
        {showWelcome ? (
          <div className="flex-1 flex items-center justify-center p-10 relative overflow-hidden">
            {/* Animated Background Blobs */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
              <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
              <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
            </div>

            <div className="max-w-3xl w-full text-center z-10 relative">
              <div className="mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 rounded-full mb-5 mx-auto">
                  <MessageSquare className="w-10 h-10 text-primary-600" />
                </div>
                <h2 className="text-3xl font-semibold text-gray-900 mb-3" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  {t('chat.welcome_title')}
                </h2>
                <p className="text-gray-600 text-base mb-10 max-w-2xl mx-auto">
                  {t('chat.welcome_body')}
                </p>
              </div>
 
              <div className="mb-8">
                <div className="flex items-center justify-center mb-5">
                  <Lightbulb className="w-5 h-5 text-amber-500 mr-2" />
                  <span className="text-base font-medium text-gray-700">{t('chat.try_asking')}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sampleQueries.map((sample, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSampleQueryClick(sample)}
                      className="p-4 text-left bg-white border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors duration-200 text-base"
                      disabled={isProcessing}
                    >
                      "{sample}"
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center mb-8">
                <div className="flex-1 border-t border-gray-200" />
                <span className="px-4 text-xs text-gray-400">{t('chat.divider_or')}</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              <div className="w-full max-w-3xl mx-auto">
                <div className="relative">
                  <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 focus-within:border-blue-500 transition-colors duration-200">
                    <textarea
                      ref={textareaRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t('chat.placeholder') as string}
                      disabled={isProcessing}
                      rows={3}
                      className="w-full px-6 py-5 pr-14 bg-transparent border-0 resize-none text-lg text-gray-900 placeholder:text-gray-400 focus:outline-none"
                    />
                    <button
                      onClick={isProcessing ? handleStop : handleSubmit}
                      disabled={!isProcessing && !query.trim()}
                      className={`absolute bottom-3 right-3 p-3 rounded-xl transition-all duration-200 ${
                        isProcessing
                          ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30'
                          : query.trim()
                          ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-500/30 hover:scale-105 active:scale-95'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {isProcessing ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-gray-400 px-2">
                  <span>{t('chat.helper_send')}</span>
                  <span>{query.length}/1000</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 space-y-6">
            {messages.map((message) => (
              <div key={message.id} className={message.type === 'results' || message.type === 'user' ? 'px-[10px]' : 'max-w-4xl mx-auto px-6'}>
                {message.type === 'user' && (
                  <div className="flex justify-end animate-fade-in-up">
                    <div className="bg-gradient-to-tr from-indigo-600 to-primary-600 text-white rounded-2xl rounded-tr-sm px-6 py-4 shadow-md shadow-primary-500/10 max-w-3xl">
                      <p className="text-base font-medium whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
                {message.type === 'ai' && (
                  <div className="flex justify-start animate-fade-in-up">
                    <div className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl rounded-tl-sm px-6 py-4 shadow-sm max-w-3xl">
                      <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}

                {message.type === 'timeline' && (
                  <StreamingTimeline status={timelines[message.content?.id]} />
                )}


                {message.type === 'disambiguation' && (
                  <InlineDisambiguation
                    conversation={message.content}
                    onComplete={(result: any) => {
                      onConversationUpdate(result);
                    }}
                    phoenixUseStream={phoenixUseStream}
                  />
                )}
                {message.type === 'results' && (
                  <InlineResults conversation={message.content} />
                )}
              </div>
            ))}


            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area (bottom) - hidden on welcome */}
      {!showWelcome && showTextarea && (
        <div className="border-t border-gray-100 bg-white/80 backdrop-blur-md px-6 py-6 z-20">
          <div className="max-w-4xl mx-auto">
            <div
              className={`relative bg-white rounded-2xl border transition-all duration-200 shadow-sm ${
                isProcessing
                  ? 'border-gray-200'
                  : 'border-gray-200 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-200/30 focus-within:shadow-lg'
              }`}
            >
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isProcessing ? (t('disambiguation.processing') as string) : (t('chat.placeholder') as string)}
                disabled={isProcessing}
                rows={1}
                className="w-full px-5 py-4 pr-14 resize-none outline-none bg-transparent text-gray-900 placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-500 text-base rounded-2xl"
                style={{ maxHeight: '200px' }}
              />
                  <button
                    onClick={isProcessing ? handleStop : handleSubmit}
                    disabled={!isProcessing && !query.trim()}
                    className={`absolute right-2 bottom-2 transition-all duration-200 ${
                      isProcessing
                        ? 'p-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-md shadow-red-500/20 hover:scale-105 active:scale-95'
                        : query.trim()
                        ? 'p-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-md shadow-primary-500/20 hover:scale-105 active:scale-95'
                        : 'p-2.5 bg-gray-100 text-gray-400 cursor-not-allowed rounded-xl'
                    }`}
                    title={isProcessing ? 'Stop generating' : 'Send'}
                    aria-label={isProcessing ? 'Stop generating' : 'Send'}
                  >
                    {isProcessing ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
                  </button>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center font-medium">{t('chat.helper_send')}</p>
          </div>
        </div>
      )}
      {notification && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-lg z-50 animate-fade-in-up">
          {notification}
        </div>
      )}
    </div>
  );
};

export default ChatView;

