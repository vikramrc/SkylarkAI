import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, ArrowRight, X, Loader2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiService from '@/services/api.service';
import StreamingProgress from '@/components/StreamingProgress';

export type DisambiguationFlowProps = {
  conversation: any;
  onComplete: (c: any) => void;
  onCancel: () => void;
  onUpdate?: (c: any) => void;
  useStreaming?: boolean;
  readOnly?: boolean;
};

const DisambiguationFlow: React.FC<DisambiguationFlowProps> = ({ conversation, onComplete, onCancel, onUpdate, useStreaming=false, readOnly=false }) => {
  const { t } = useTranslation();
  const [responses, setResponses] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number|null>(null);
  const [subtleStatus, setSubtleStatus] = useState('');
  const [heartbeatCount, setHeartbeatCount] = useState(0);
  const [activityLevel, setActivityLevel] = useState(0);
  const [streamActive, setStreamActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusMessageKey, setStatusMessageKey] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const eventSourceRef = useRef<EventSource|null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const { clarifyingQuestions, assumptions, originalQuery, disambiguationLog } = conversation || {};

  const handleResponseChange = (index: number, value: string) => {
    const newResponses = [...responses];
    newResponses[index] = value;
    setResponses(newResponses);
  };

  useEffect(() => {
    const cleanup = () => {
      if (eventSourceRef.current) { try { eventSourceRef.current.close(); } catch {} eventSourceRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    window.addEventListener('beforeunload', cleanup);
    return () => { cleanup(); window.removeEventListener('beforeunload', cleanup); };
  }, []);

  useEffect(() => {
    const saved = disambiguationLog?.userResponses;
    if (Array.isArray(saved) && saved.length > 0) {
      setResponses(saved);
    } else if (originalQuery && (!responses[0] || responses[0].trim().length === 0)) {
      setResponses([originalQuery]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const filteredResponses = responses.filter(r => r && r.trim());
    if (filteredResponses.length === 0) { setError(t('disambiguation.please_response')); return; }

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

    try {
      if (useStreaming) {
        if (eventSourceRef.current) { try { eventSourceRef.current.close(); } catch {} eventSourceRef.current = null; }
        const url = `/phoenix-openai/disambiguate/stream?conversationId=${encodeURIComponent(conversation.conversationId)}&responses=${encodeURIComponent(JSON.stringify(filteredResponses))}`;
        const es = apiService.createEventSource(url);
        eventSourceRef.current = es;
        setStreamActive(true);

        let streamClosed = false;
        const close = () => {
          if (!streamClosed) {
            streamClosed = true;
            try { es.close(); } catch {};
            eventSourceRef.current = null;
            setStreamActive(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
        };

        es.addEventListener('status', (ev: MessageEvent) => {
          try {
            const d = JSON.parse(ev.data || '{}');
            setSubtleStatus(d.stage || '');

            // Handle streaming status messages
            if (d.messageKey) {
              setStatusMessageKey(d.messageKey);
              setStatusMessage('');
            } else if (d.message) {
              setStatusMessage(d.message);
              setStatusMessageKey('');
            }

            // Update token count if provided
            if (typeof d.tokens === 'number') {
              setTokenCount(d.tokens);
            }
          } catch {}
        });
        es.addEventListener('heartbeat', (ev: MessageEvent) => { try { const d = JSON.parse(ev.data || '{}'); setHeartbeatCount(p=>p+1); const score = typeof d.activityScore === 'number' ? d.activityScore : 0; const nextLevel = score >= 0.85 ? 4 : score >= 0.6 ? 3 : score >= 0.35 ? 2 : score > 0.05 ? 1 : 0; setActivityLevel(nextLevel); } catch {} });

        es.addEventListener('disambiguation', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data || '{}');
            onUpdate?.(data);
            // Clear previous input so the screen reflects the latest ambiguity
            setResponses([]);
          } catch {}
          setIsLoading(false);
        });

        es.addEventListener('error', (ev: MessageEvent) => { try { const d = JSON.parse(ev.data || '{}'); setError(d.message || t('chat.error_stream')); } catch { setError(t('chat.error_stream')); } setIsLoading(false); close(); });
        es.addEventListener('result', async (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data || '{}');
            try { const full = await apiService.getConversation(data.conversationId); onComplete(full || data); } catch { onComplete(data); }
          } catch {}
          setIsLoading(false); close();
        });
        es.addEventListener('end', () => { setIsLoading(false); close(); });
      } else {
        const result = await apiService.submitDisambiguation(conversation.conversationId, filteredResponses);
        if (result.status === 'ambiguous') { onUpdate?.(result); }
        else {
          try { const full = await apiService.getConversation(result.conversationId); onComplete(full || result); } catch { onComplete(result); }
        }
      }
    } catch (err: any) {
      console.error('Disambiguation failed:', err);
      setError(err?.message || t('disambiguation.failed_general'));
    } finally {
      if (!useStreaming) {
        setIsLoading(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="card">
          <div className="card-header bg-white/50 backdrop-blur-sm border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center justify-center w-12 h-12 bg-blue-50 rounded-2xl shadow-sm">
                  <HelpCircle className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{t('disambiguation.need_more_info')}</h3>
                  <p className="text-sm text-gray-600">{t('disambiguation.needs_clarification')}</p>
                </div>
              </div>
              {!readOnly && (
                <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {conversation.detected_issues && conversation.detected_issues.length > 0 && (
            <div className="px-6 pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('disambiguation.detected_issues')}</label>
              <div className="space-y-3">
                {conversation.detected_issues.map((issue: any, idx: number) => (
                  <div key={idx} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div className="flex items-start gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5" />
                      <div className="text-sm text-gray-800"><span className="font-medium">{issue.category}:</span> {issue.problem}</div>
                    </div>
                    {issue.possible_interpretations && issue.possible_interpretations.length > 0 && (
                      <ul className="list-disc pl-6 text-sm text-gray-700 space-y-1">
                        {issue.possible_interpretations.map((pi: any, piIdx: number) => (<li key={piIdx}>{pi}</li>))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card-body space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('disambiguation.original_query')}</label>
              <div className="p-4 bg-gray-50/80 rounded-xl border border-gray-200/60 shadow-inner"><p className="text-gray-900 italic font-medium">"{originalQuery}"</p></div>
            </div>

            {clarifyingQuestions && clarifyingQuestions.length > 0 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-2">{t('disambiguation.clarifying_questions')}</label>
                  <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                    <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-800">
                      {clarifyingQuestions.map((q: string, index: number) => (<li key={index}>{q}</li>))}
                    </ol>
                  </div>
                </div>

                {assumptions && assumptions.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('disambiguation.assumptions_intro')}</label>
                    <div className="bg-blue-50/50 border border-blue-200/60 rounded-xl p-4 shadow-sm">
                      <ul className="text-sm text-blue-800 space-y-1">
                        {assumptions.map((assumption: string, index: number) => (
                          <li key={index} className="flex items-start justify-between gap-2">
                            <div className="flex items-start"><span className="text-blue-600 mr-2">•</span><span>{assumption}</span></div>
                            <button
                              type="button"
                              className={`btn-ghost text-xs px-2 py-1 ${copiedIndex === index ? 'text-green-700' : ''}`}
                              title={t('disambiguation.copy_suggestion')}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(String(assumption || ''));
                                  setCopiedIndex(index);
                                } catch {}
                              }}
                            >
                              {copiedIndex === index ? t('disambiguation.copied') : t('disambiguation.copy')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('disambiguation.reenter_label')}</label>
                  <textarea className="input-field min-h-[100px] rounded-xl border-gray-200 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all shadow-sm" placeholder={t('disambiguation.reenter_placeholder') as string} value={responses[0] || ''} onChange={(e) => handleResponseChange(0, e.target.value)} disabled={readOnly} />
                  <p className="mt-1 text-xs text-gray-500">{t('disambiguation.reenter_note')}</p>
                </div>

                {error && (<div className="p-3 bg-red-50 border border-red-200 rounded-lg"><p className="text-sm text-red-700">{error}</p></div>)}

                <StreamingProgress
                  isLoading={isLoading}
                  useStreaming={useStreaming || streamActive}
                  subtleStatus={subtleStatus}
                  heartbeatCount={heartbeatCount as any}
                  activityLevel={activityLevel}
                  statusMessage={statusMessage}
                  statusMessageKey={statusMessageKey}
                  elapsedSeconds={elapsedSeconds}
                  tokenCount={tokenCount}
                  className="mb-4"
                />

                <div className="flex items-center justify-between pt-2">
                  {!readOnly && (<button type="button" onClick={onCancel} className="btn-secondary">{t('disambiguation.cancel')}</button>)}
                  <div className="flex items-center space-x-3">
                    {!readOnly && (
                      <button type="button" className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-xl shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 hover:-translate-y-0.5 transition-all duration-200" onClick={handleSubmit} disabled={isLoading || !(responses[0] && responses[0].trim().length > 0)}>
                        {isLoading ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>{t('disambiguation.processing')}</span></>) : (<><span>{t('disambiguation.continue')}</span><ArrowRight className="w-4 h-4" /></>)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisambiguationFlow;

