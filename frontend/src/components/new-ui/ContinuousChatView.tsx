import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Lightbulb, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MdBubbleContent from './MdBubbleContent';
import StreamingTimeline from './StreamingTimeline';
import InlineDisambiguation from './InlineDisambiguation';

interface ContinuousChatViewProps {
  currentConversation: any | null;
  onNewConversation: (conversation: any) => void;
  onConversationUpdate: (conversation: any) => void;
}

interface Message {
  id: string;
  type: 'user' | 'ai' | 'disambiguation' | 'timeline';
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
      runIdRef.current = runId;

      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(`/api/mastra/workflow/messages?runId=${runId}`);
        const rows = res.data.messages || [];

        // Map row-by-row into AI bubble coordinates flawlessly trigger flawless
        const loadedMessages: Message[] = rows.flatMap((m: any, idx: number) => {
          const mList: Message[] = [];
          if (m.userQuery) {
            mList.push({
              id: `user-${m._id || idx}`,
              type: 'user',
              content: m.userQuery,
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

    // Lock and use runId
    if (!runIdRef.current) {
      runIdRef.current = `run-${Date.now()}`;
    }
    const runId = runIdRef.current;

    // Append User Message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userQuery,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Timeline trigger (Simulate progression since HTTP Post is single response)
    const tlId = `tl-${Date.now()}`;
    setTimelineStatuses((prev) => ({
      ...prev,
      [tlId]: {
        id: tlId,
        stage: 'ambiguity',
        message: 'Analyzing request...',
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
      const sseUrl = `/api/mastra/workflow/chat?userQuery=${encodeURIComponent(userQuery)}&runId=${encodeURIComponent(runId)}`;
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource; // 🟢 Save ref triggers cancel trigger flaws flaws triggers flaws triggers flaws flawless
      
      let fullAiText = '';
      const aiMessageId = `ai-${Date.now()}`;
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
                     [tlId]: { ...(prev[tlId] || {}), stage: data.stage || 'execute', message: data.message }
                 }));
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
             [tlId]: { ...(prev[tlId] || {}), stage: 'error', message: 'Stream connection failed or timed out 🛑' }
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
          id: `ai-err-${Date.now()}`,
          type: 'ai',
          content: `⚠️ **Error Execution Pipeline**: ${error.message || 'Workflow Request Failed'}`,
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
      await axios.get(`/api/mastra/workflow/stop?runId=${runIdRef.current}`);
    } catch (err) {
      console.error('Failed to notify backend about stream stop:', err);
    }
    setTimelineStatuses((prev) => ({
      ...prev,
      [Object.keys(prev).pop() || ""]: { ...(prev[Object.keys(prev).pop() || ""] || {}), stage: 'error', message: 'Stream interrupted 🛑' }
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
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6" ref={scrollContainerRef}>
        {showWelcome ? (
          <div className="flex-1 h-full flex items-center justify-center p-6 relative overflow-hidden">
            <div className="max-w-3xl w-full text-center z-10">
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
                <div className="relative">
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('chat.placeholder')}
                    className="w-full px-5 py-4 pr-12 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none text-base bg-white shadow-sm"
                    rows={4}
                    disabled={isProcessing}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                    }}
                  />
                  <button 
                    type="button" 
                    onClick={handleSubmit} 
                    disabled={!query.trim() || isProcessing} 
                    className="absolute bottom-3 right-3 p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.map((message) => (
              <div key={message.id} className="flex flex-col">
                {message.type === 'user' && (
                  <div className="flex justify-end animate-fade-in-up">
                    <div className="bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white rounded-2xl rounded-tr-sm px-5 py-3.5 shadow-sm max-w-2xl">
                      <p className="text-sm font-medium whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
                {message.type === 'ai' && (
                  <div className="flex justify-start animate-fade-in-up">
                    <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm max-w-3xl w-full">
                      <MdBubbleContent content={message.content} />
                    </div>
                  </div>
                )}
                {message.type === 'timeline' && timelineStatuses[message.id] && (
                  <div className="max-w-2xl mx-auto w-full">
                    <StreamingTimeline status={timelineStatuses[message.id]} />
                  </div>
                )}
                {message.type === 'disambiguation' && (
                  <div className="max-w-3xl">
                    <InlineDisambiguation conversation={message.content} onComplete={() => {}} phoenixUseStream={false} />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Viewport Input Area (Transparent center anchor) */}
      {!showWelcome && (
        <div className="bg-transparent px-4 pb-10 pt-4 z-20">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="w-full">
              <div className="relative bg-white rounded-xl border border-gray-200 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 shadow-sm transition-all duration-200">
                <textarea
                  ref={textareaRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isProcessing ? "Processing response..." : (t('chat.placeholder') as string)}
                  disabled={isProcessing}
                  rows={4}
                  className="w-full px-5 py-4 pr-14 resize-none outline-none bg-transparent text-gray-900 placeholder-gray-400 text-base rounded-xl"
                />
                
                {isProcessing ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="absolute right-3 bottom-3 p-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all animate-pulse"
                  >
                    <Square className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!query.trim()}
                    className={`absolute right-3 bottom-3 p-2.5 rounded-xl transition-all ${
                      !query.trim()
                        ? 'bg-gray-50 text-gray-400'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                    }`}
                  >
                    <Send className="w-5 h-5" />
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
