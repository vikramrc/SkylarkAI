import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Lightbulb } from 'lucide-react';
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
  const [timelineStatus, setTimelineStatus] = useState<any>(null);

  const sampleQueries = (t('chat.sample_queries', { returnObjects: true }) as unknown as string[]) || [];

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [query]);

  // Load continuous conversation turns if it's fed
  useEffect(() => {
    if (!currentConversation) {
      setMessages([]);
      runIdRef.current = null;
      setTimelineStatus(null);
      return;
    }
    // For loaded conversations, we could hydrate from content histories if needed
    // But sinceMastras Workflow memory is in memory servers on BE, we can just track runId continuity
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
    setTimelineStatus({
      id: tlId,
      stage: 'ambiguity',
      message: 'Analyzing request...',
      startTime: Date.now(),
    });

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
      // Direct Fetch to the newly added Mastra bridge route
      const response = await fetch('/api/mastra/workflow/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header forwarding for transparent Auth will set cookie relays automatically
        },
        body: JSON.stringify({ userQuery, runId }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Mastra Workflow request failed with status: ${response.status}`);
      }

      const result = await response.json();

      setTimelineStatus({ stage: 'done', message: '' });

      if (result.status === 'success') {
        // Append AI response with MdBubbleContent
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            type: 'ai',
            content: result.response,
            timestamp: new Date(),
          },
        ]);
        
        // Notify Parent of a continuous updates on stream
        if (!currentConversation) {
            onNewConversation({ conversationId: runId, userQuery, status: 'completed', createdAt: new Date() });
        }
      }

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
      setTimelineStatus(null);
    } finally {
      setIsProcessing(false);
    }
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
              <h2 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
                {t('chat.welcome_title')}
              </h2>
              <p className="text-gray-600 text-base mb-10 max-w-xl mx-auto">
                Continuous Continuous workflow environment synced with the Mastra workspace context.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl mx-auto">
                {sampleQueries.slice(0, 4).map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => setQuery(sample)}
                    className="p-4 text-left bg-white/80 border border-gray-100 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all text-sm"
                  >
                    <span className="text-gray-700">"{sample}"</span>
                  </button>
                ))}
              </div>
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
                {message.type === 'timeline' && timelineStatus && timelineStatus.stage !== 'done' && (
                  <div className="max-w-2xl mx-auto w-full">
                    <StreamingTimeline status={timelineStatus} />
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

      {/* Input Area */}
      <div className="border-t border-gray-100 bg-white/80 backdrop-blur-md px-4 py-4 z-20">
        <div className="max-w-4xl mx-auto">
          <div className="relative bg-white rounded-xl border border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100/30 shadow-sm transition-all duration-200">
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isProcessing ? "Processing response..." : (t('chat.placeholder') as string)}
              disabled={isProcessing}
              rows={1}
              className="w-full px-4 py-3.5 pr-14 resize-none outline-none bg-transparent text-gray-900 placeholder-gray-400 text-sm rounded-xl"
              style={{ maxHeight: '150px' }}
            />
            <button
              onClick={handleSubmit}
              disabled={isProcessing || !query.trim()}
              className={`absolute right-2 bottom-2 p-2 rounded-lg transition-all ${
                isProcessing || !query.trim()
                  ? 'bg-gray-50 text-gray-400'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContinuousChatView;
