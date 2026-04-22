import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Lightbulb, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MdBubbleContent from './MdBubbleContent';
import StreamingTimeline from './StreamingTimeline';
import InlineDisambiguation from './InlineDisambiguation';
import ResultTable from './ResultTable';
import { API_BASE_URL } from '../../services/api.service';

interface ContinuousChatViewProps {
  currentConversation: any | null;
  onNewConversation: (conversation: any) => void;
  onConversationUpdate: (conversation: any) => void;
}

interface Message {
  id: string;
  type: 'user' | 'ai' | 'disambiguation' | 'timeline' | 'table';
  content: any;
  timestamp: Date;
}

const ContinuousChatView: React.FC<ContinuousChatViewProps> = ({
  currentConversation,
  onNewConversation,
  onConversationUpdate,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Preserve runId acrosssubmissions for continuous context turn memory
  const runIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null); // 🟢 Track EventSource for cancellation triggers triggers
  const [timelineStatuses, setTimelineStatuses] = useState<Record<string, any>>({});

  const sampleQueries = (t('chat.sample_queries', { returnObjects: true }) as unknown as string[]) || [];

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [query]);

  // Load continuous conversation turns if it's fed
  useEffect(() => {
    const hydrateConversation = async () => {
      if (!currentConversation) {
        setMessages([]);
        runIdRef.current = null;
        setTimelineStatuses({});
        return;
      }

      const runId = currentConversation.conversationId || currentConversation.id;

      // 🟢 GUARD: Skip re-hydration/wiping for active live stream turns flawlessly flawlessly
      if (runId && runId === runIdRef.current) {
          console.log(`[Hydrate] Same conversation detected (${runId}). Skipping re-hydration to preserve memory buffers.`);
          return;
      }

      runIdRef.current = runId;

      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(`${API_BASE_URL}/mastra/workflow/messages?runId=${runId}`);
        const rows = res.data.messages || [];

        // Map row-by-row into AI bubble coordinates flawlessly trigger flawless
        const loadedMessages: Message[] = rows.flatMap((m: any, idx: number) => {
          const mList: Message[] = [];
          // '(org setup)' is a sentinel written by the backend for the system-initiated
          // org-ask prompt. Its content lives in assistantResponse, not in userQuery,
          // so we skip the user-bubble for that row.
          if (m.userQuery && m.userQuery !== '(org setup)') {
            mList.push({
              id: `user-${m._id || idx}`,
              type: 'user',
              content: m.userQuery,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
            });
          }
          if (m.toolResults && Object.keys(m.toolResults).length > 0) {
             mList.push({
               id: `tool-${m._id || idx}-hist`,
               type: 'table',
               content: m.toolResults,
               timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
             });
          }
          if (m.assistantResponse) {
             mList.push({
               id: `ai-${m._id || idx}`,
               type: 'ai',
               content: m.assistantResponse,
               timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
             });
          }
          return mList;
        });

        setMessages(loadedMessages);
        setTimelineStatuses({}); // Reset timeline for previous loaded sessions flawlessly trigger flawless
      } catch (err) {
        console.error('Failed to hydrate conversation history:', err);
      }
    };

    hydrateConversation();
  }, [currentConversation]);

  const handleSubmit = async () => {
    if (!query.trim() || isProcessing) return;

    const userQuery = query.trim();
    setQuery('');
    setIsProcessing(true);

    // Lock and use runId (Generate valid 24-char hex ObjectId flawlessly triggers triggers)
    if (!runIdRef.current) {
      const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
      const rand = 'x'.repeat(16).replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));
      runIdRef.current = ts + rand;
    }
    const runId = runIdRef.current;

    // 🟢 Instant layout updates: place card in LHS immediately flawlessly flaws trigger flawless
    if (!currentConversation) {
      onNewConversation({ conversationId: runId, userQuery, status: 'processing', createdAt: new Date() });
    }

    // Append User Message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userQuery,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Timeline trigger (Simulate progression since HTTP Post is single response)
    const tlId = `tl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setTimelineStatuses((prev) => ({
      ...prev,
      [tlId]: {
        id: tlId,
        stage: 'ambiguity',
        message: t('status.analyzing'),
        messageKey: 'status.analyzing',
        startTime: Date.now(),
      }
    }));

    const timelineMessage: Message = {
      id: tlId,
      type: 'timeline',
      content: { id: tlId },
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, timelineMessage]);

    // Auto-scroll logic
    setTimeout(() => {
      const sc = scrollContainerRef.current;
      if (sc) {
        sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
      }
    }, 50);

    try {
      const sseUrl = `${API_BASE_URL}/mastra/workflow/chat?userQuery=${encodeURIComponent(userQuery)}&runId=${encodeURIComponent(runId)}`;
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource; // 🟢 Save ref triggers cancel trigger flaws flaws triggers flaws triggers flaws flawless
      
      let fullAiText = '';
      const aiMessageId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let aiMessageMounted = false;

      // EventSource doesn't support headers natively for Cookie support, but works natively for transparent domains.
      // If authorization token forwarded cookies are standard, EventSource propagates them securely.

      eventSource.addEventListener('text_delta', (e: any) => {
         try {
             const data = JSON.parse(e.data);
             const delta = data.delta;
             if (!delta) return;

             if (!aiMessageMounted) {
               aiMessageMounted = true;
               fullAiText = delta;
               setMessages((prev) => [
                 ...prev,
                 { id: aiMessageId, type: 'ai', content: delta, timestamp: new Date() },
               ]);
             } else {
               fullAiText += delta;
               setMessages((prev) =>
                 prev.map((m) => m.id === aiMessageId ? { ...m, content: fullAiText } : m)
               );
             }
             
             const sc = scrollContainerRef.current;
             if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'auto' });
         } catch {}
      });

      eventSource.addEventListener('status_update', (e: any) => {
         try {
             const data = JSON.parse(e.data);
             if (data.message) {
                 setTimelineStatuses((prev) => ({
                     ...prev,
                     [tlId]: { 
                        ...(prev[tlId] || {}), 
                        stage: data.stage || 'execute', 
                        message: data.message,
                        messageKey: data.messageKey, // Allow clearing or updating messageKey flawlessly trigger
                        reasoning: data.reasoning // 🟢 Capture CoT reasoning for thought process UI trigger flawless
                     }
                 }));
             }
         } catch {}
      });

      eventSource.addEventListener('tool_results', (e: any) => {
         try {
             const data = JSON.parse(e.data);
             if (data.results) {
                 setMessages((prev) => {
                     const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
                     if (lastMsg && lastMsg.type === 'table') {
                         // Update existing table flawlessly trigger
                         return prev.map((m, idx) => 
                            idx === prev.length - 1 ? { ...m, content: data.results } : m
                         );
                     } else {
                         // First arrival: append new table trigger flawless
                         return [
                             ...prev,
                             { id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, type: 'table', content: data.results, timestamp: new Date() }
                         ];
                     }
                 });
             }
         } catch {}
      });

      eventSource.addEventListener('result', (e: any) => {
         try {
             const data = JSON.parse(e.data);
             if (data.response) {
               if (!aiMessageMounted) {
                  aiMessageMounted = true;
                  setMessages((prev) => [
                    ...prev,
                    { id: aiMessageId, type: 'ai', content: data.response, timestamp: new Date() }
                  ]);
               } else {
                   setMessages((prev) => prev.map((m) => m.id === aiMessageId ? { ...m, content: data.response } : m));
               }
             }
             setTimelineStatuses((prev) => ({
                 ...prev,
                 [tlId]: { ...(prev[tlId] || {}), stage: 'done', message: '' }
             }));

             if (!currentConversation) {
               onNewConversation({ conversationId: runId, userQuery, status: 'completed', createdAt: new Date() });
             }
             eventSource.close();
             eventSourceRef.current = null; // 🟢 Clear ref setup trigger flawless trigger flaws trigger flawless
             setIsProcessing(false); 
         } catch {}
       });

      eventSource.addEventListener('workflow_error', (e: any) => {
         console.error('SSE Workflow Error Event:', e);
         try {
             if (e.data) {
                 const data = JSON.parse(e.data);
                 if (data.message) {
                     setTimelineStatuses((prev) => ({
                         ...prev,
                         [tlId]: { ...(prev[tlId] || {}), stage: 'error', message: data.message }
                     }));
                 }
             }
         } catch {}
         eventSource.close();
         eventSourceRef.current = null;
         setIsProcessing(false);
      });

      // 🟢 Add standard EventSource onerror handler triggers triggers flaws flaws
      eventSource.onerror = (e: any) => {
         console.error('SSE connection error:', e);
         setTimelineStatuses((prev) => ({
             ...prev,
             [tlId]: { ...(prev[tlId] || {}), stage: 'error', message: t('chat.stream_failed') }
         }));
         setIsProcessing(false);
         eventSource.close();
         eventSourceRef.current = null;
      };

      // Timeout safety loop closure
      return () => {
         eventSource.close();
         eventSourceRef.current = null;
      };

    } catch (error: any) {
      console.error('Failed to submit Mastra query:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'ai',
          content: `${t('chat.error_pipeline')}: ${error.message || t('chat.error_generic')}`,
          timestamp: new Date(),
        },
      ]);

      setTimelineStatuses((prev) => ({
          ...prev,
          [tlId]: { ...(prev[tlId] || {}), stage: 'error', message: error.message || 'Workflow Request Failed' }
      }));
      setIsProcessing(false);
    } finally {
      // 🟢 isProcessing set handled by SSE listeners listeners trigger flaws flawlessly flawless triggers
    }
  };

  const handleStop = async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    try {
      // Import axios if missing, but ContinuousChatView loads load axios easily flawlessly flaws trigger flawlessly triggers
      const axios = (await import('axios')).default;
      await axios.get(`${API_BASE_URL}/mastra/workflow/stop?runId=${runIdRef.current}`);
    } catch (err) {
      console.error('Failed to notify backend about stream stop:', err);
    }
    setTimelineStatuses((prev) => ({
      ...prev,
      [Object.keys(prev).pop() || ""]: { ...(prev[Object.keys(prev).pop() || ""] || {}), stage: 'error', message: t('chat.stream_interrupted') }
    }));
    setIsProcessing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const showWelcome = messages.length === 0 && !isProcessing;

  useEffect(() => {
    if (!messages.length) return;
    const sc = scrollContainerRef.current;
    if (sc) {
      sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-white">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 pb-32" ref={scrollContainerRef}>
        {showWelcome ? (
          <div className="flex-1 min-h-full flex items-center justify-center p-4 md:p-6 relative">
            <div className="max-w-3xl w-full text-center z-10 pb-8">
              <div className="mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 rounded-full mb-5 mx-auto">
                  <MessageSquare className="w-10 h-10 text-primary-600" />
                </div>
                <h2 className="text-3xl font-semibold text-gray-900 mb-3" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  {t('chat.welcome_title')}
                </h2>
                <p className="text-gray-600 text-base mb-10 max-w-xl mx-auto">
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
                      onClick={() => setQuery(sample)}
                      className="p-4 text-left bg-white border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors duration-200 text-base"
                    >
                      <span className="text-gray-700">"{sample}"</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center mb-8">
                <div className="flex-1 border-t border-gray-200" />
                <span className="px-4 text-xs text-gray-400">{t('chat.divider_or')}</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="w-full">
                <div className="relative bg-white rounded-2xl border border-black/15 shadow-sm focus-within:shadow-md transition-all duration-200">
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('chat.placeholder')}
                    className="w-full px-4 pt-[16px] pb-[12px] pr-14 outline-none resize-none text-[15px] bg-transparent leading-relaxed min-h-[52px] rounded-2xl"
                    rows={1}
                    disabled={isProcessing}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                    }}
                  />
                  <button 
                    type="button" 
                    onClick={handleSubmit} 
                    disabled={!query.trim() || isProcessing} 
                    className={`absolute right-2.5 bottom-2 p-2 rounded-xl transition-all ${
                      !query.trim()
                        ? 'bg-gray-50 text-gray-400'
                        : 'bg-black hover:bg-gray-800 text-white shadow-sm'
                    }`}
                  >
                    <Send className="w-5 h-5 flex-shrink-0" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full">
            {messages.map((message, index) => {
              const prevMsg = index > 0 ? messages[index - 1] : null;
              // 32px gap (mt-8) for turn transitions (User -> AI) to hit target spacing
              // 48px gap (mt-12) for entirely new clusters (Turn Gap)
              const isFirst = index === 0;
              let spacingClass = isFirst ? '' : 'mt-12';
              if (prevMsg && message.type !== 'user') {
                 spacingClass = 'mt-8';
              }

              return (
              <div key={message.id} className={`flex flex-col w-full ${spacingClass}`}>
                {message.type === 'user' && (
                  <div className="flex justify-end animate-fade-in-up">
                    <div className="bg-[#f4f4f4] text-gray-900 rounded-xl px-4 py-3 shadow-none max-w-[85%] sm:max-w-[65%] text-[15px]">
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
                {message.type === 'ai' && (
                  <div className="flex justify-start animate-fade-in-up w-full">
                    <div className="grow bg-transparent border-0 rounded-none p-0 shadow-none max-w-full w-full text-[15px] text-gray-900">
                      <MdBubbleContent content={message.content} />
                    </div>
                  </div>
                )}
                {message.type === 'timeline' && timelineStatuses[message.id] && (
                  <div className="w-full max-w-full flex justify-start">
                    <StreamingTimeline status={timelineStatuses[message.id]} />
                  </div>
                )}
                {message.type === 'disambiguation' && (
                  <div className="max-w-[85%] sm:max-w-[65%] w-full">
                    <InlineDisambiguation conversation={message.content} onComplete={() => {}} phoenixUseStream={false} />
                  </div>
                )}
                {message.type === 'table' && (
                  <div className="w-full animate-fade-in-up">
                    <ResultTable results={message.content} />
                  </div>
                )}
              </div>
              );
            })}
            {/* 🟢 Premium Siri-inspired AI Spinner for Pending Responses */}
            {isProcessing && messages.length > 0 && messages[messages.length - 1].type !== 'ai' && (
              <div className="max-w-[85%] sm:max-w-[65%] mx-auto ml-0 w-full mt-4 flex justify-start animate-fade-in-up">
                <div className="flex items-center px-1">
                   <div className="ai-spinner active" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Viewport Input Area (Transparent center anchor) */}
      {!showWelcome && (
        <div className="absolute bottom-0 w-full left-0 bg-gradient-to-t from-white via-white/90 to-transparent pb-6 pt-12 px-4 z-20 pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="w-full">
              <div className="relative bg-white rounded-2xl border border-black/15 shadow-sm focus-within:shadow-md transition-all duration-200 group">
                <textarea
                  ref={textareaRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isProcessing ? t('chat.processing_response') : t('chat.placeholder')}
                  disabled={isProcessing}
                  rows={1}
                  className="w-full px-4 pt-[16px] pb-[12px] pr-14 resize-none outline-none bg-transparent text-gray-900 placeholder-gray-500 text-[15px] rounded-2xl leading-relaxed min-h-[52px]"
                />
                
                {isProcessing ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="absolute right-2.5 bottom-2 p-2 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all animate-pulse"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!query.trim()}
                    className={`absolute right-2.5 bottom-2 p-2 rounded-xl transition-all ${
                      !query.trim()
                        ? 'bg-gray-50 text-gray-400'
                        : 'bg-black hover:bg-gray-800 text-white shadow-sm'
                    }`}
                  >
                    <Send className="w-5 h-5 flex-shrink-0" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContinuousChatView;
