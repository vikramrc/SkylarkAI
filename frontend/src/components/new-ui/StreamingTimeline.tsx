import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Loader2, Circle, ChevronRight, Check, ChevronDown } from 'lucide-react';

// Vertical, centered timeline that ACCUMULATES events per stage (tree view)
// Messages never vanish; duplicates are suppressed per (stage|messageKey|message)

export type StreamingStatus = {
  stage: 'ambiguity' | 'generation' | 'execute' | string;
  message?: string;
  messageKey?: string;
  startTime: number;
  activityLevel?: number;
  tokenCount?: number;
  reasoning?: string; // 🟢 Field for CoT thought process trigger flawless
};

interface TimelineItem {
  id: string;
  stage: StreamingStatus['stage'];
  message?: string;
  messageKey?: string;
  timestamp: number;
  elapsedSeconds: number;
  // When BE signals a retry via status.re_analyzing, mark the last Execute item as failed
  forcedError?: boolean;
  reasoning?: string; // 🟢 Persist reasoning into timeline rows flawlessly
}

interface Props { status: StreamingStatus | null; }

const SPINNER_FRAMES = ['\u280b','\u2819','\u2839','\u2838','\u283c','\u2834','\u2826','\u2827','\u2807','\u280f'];
const STAGES: Array<'ambiguity'|'generation'|'execute'> = ['ambiguity','generation','execute'];

const StreamingTimeline: React.FC<Props> = ({ status }) => {
  const { t } = useTranslation();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const lastKeyRef = useRef<string | null>(null);
  // After a BE re_analyzing event, allow the next 'executing_query' message to appear again
  const allowNextExecuteRepeatRef = useRef<boolean>(false);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setSpinnerFrame((p) => (p + 1) % SPINNER_FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, []);
  // Tick every 1s to keep the active message's seconds increasing
  // Only run while there is an active, non-error tail item in the current stage.
  useEffect(() => {
    if (!status) return;
    // find last item of the current stage
    let last: TimelineItem | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].stage === status.stage) { last = items[i]; break; }
    }
    if (!last) return;
    const isError = (last.messageKey && last.messageKey.toLowerCase().includes('error')) || /^error[:\s]/i.test(last.message || '');
    if (isError) return; // freeze when error is shown

    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status?.stage, status?.startTime, items]);

  // When stage changes, finalize the last item of the previous stage
  const prevStageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const prevStage = prevStageRef.current;
    if (prevStage && prevStage !== status.stage) {
      setItems((prev) => {
        let lastIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].stage === prevStage) { lastIdx = i; break; }
        }
        if (lastIdx === -1) return prev;
        const now = Date.now();
        const updated = [...prev];
        const last = updated[lastIdx];
        const duration = Math.max(0, Math.floor((now - last.timestamp) / 1000));
        if (duration > last.elapsedSeconds) {
          updated[lastIdx] = { ...last, elapsedSeconds: duration };
        }
        return updated;
      });
    }
    prevStageRef.current = status.stage;
  }, [status?.stage]);



  // Accumulate (skip blank events with no message/messageKey) with de-duplication
  // If a placeholder text (e.g., "Analyzing request...") was added before SSE starts,
  // and the first SSE brings the same message via messageKey, we MERGE instead of adding a duplicate.
  useEffect(() => {
    if (!status) return;
    const hasText = !!(status.messageKey && status.messageKey.length) || !!(status.message && status.message.trim().length);
    if (!hasText) return;

    const key = `${status.stage}|${status.messageKey ?? ''}|${status.message ?? ''}`;
    if (key === lastKeyRef.current) return;

    const now = Date.now();
    const incomingTextRaw = status.messageKey ? t(status.messageKey) : (status.message ?? '');
    const normalize = (s: string) => s.replace(/\u2026/g, '...').replace(/[.]+$/,'').trim().toLowerCase();
    const incomingText = normalize(incomingTextRaw);

    setItems((prev) => {
      let base = prev;

      // Special-case: if backend signals a retry via status.re_analyzing, mark the
      // last Execute-stage item (preferably 'status.executing_query') as a failure (X)
      if (status.messageKey === 'status.re_analyzing') {
        let execIdx = -1;
        for (let i = base.length - 1; i >= 0; i--) {
          const it = base[i];
          if (it.stage === 'execute' && it.messageKey === 'status.executing_query') { execIdx = i; break; }
        }
        if (execIdx === -1) {
          for (let i = base.length - 1; i >= 0; i--) {
            const it = base[i];
            if (it.stage === 'execute') { execIdx = i; break; }
          }
        }
        if (execIdx !== -1) {
          const it = base[execIdx];
          const duration = Math.max(0, Math.floor((now - it.timestamp) / 1000));
          const nextArr = [...base];
          nextArr[execIdx] = { ...it, forcedError: true, elapsedSeconds: Math.max(it.elapsedSeconds, duration) };
          base = nextArr;
        }
        // Allow the next 'Executing query' message to appear again (no de-dup)
        allowNextExecuteRepeatRef.current = true;
      }

      // Special-case: if user cancels (status.cancelled), mark the last item of current stage as failure (X)
      if (status.messageKey === 'status.cancelled') {
        let lastIdx = -1;
        for (let i = base.length - 1; i >= 0; i--) {
          if (base[i].stage === status.stage) { lastIdx = i; break; }
        }
        if (lastIdx !== -1) {
          const it = base[lastIdx];
          const duration = Math.max(0, Math.floor((now - it.timestamp) / 1000));
          const nextArr = [...base];
          nextArr[lastIdx] = { ...it, forcedError: true, elapsedSeconds: Math.max(it.elapsedSeconds, duration) };
          base = nextArr;
        }
      }

      // Special-case: if general string status is 'error', mark the last item of the list as failed with details
      if (status.stage === 'error' || status.stage === 'failed') {
        const errIdx = base.length - 1;
        if (errIdx >= 0) {
          const it = base[errIdx];
          const duration = Math.max(0, Math.floor((now - it.timestamp) / 1000));
          const nextArr = [...base];
          nextArr[errIdx] = { 
            ...it, 
            forcedError: true, 
            message: status.message || it.message, 
            elapsedSeconds: Math.max(it.elapsedSeconds, duration) 
          };
          allowNextExecuteRepeatRef.current = true;
          return nextArr;
        }
      }

      // Find the last item for this stage to support de-duplication
      let lastIdx = -1;
      for (let i = base.length - 1; i >= 0; i--) {
        if (base[i].stage === status.stage) { lastIdx = i; break; }
      }

      if (lastIdx !== -1) {
        const last = base[lastIdx];
        const lastTextRaw = last.messageKey ? t(last.messageKey) : (last.message ?? '');
        const lastText = normalize(lastTextRaw);
        let textsMatch = lastText.length > 0 && lastText === incomingText;

        // Always show 'Executing query' items (append even if previous execute item has same text).
        if (status.stage === 'execute' && status.messageKey === 'status.executing_query') {
          textsMatch = false;
        }
        // Additionally, after re_analyzing, allow the very next 'executing_query' to show again
        const bypassRepeat = status.stage === 'execute' && status.messageKey === 'status.executing_query' && allowNextExecuteRepeatRef.current;
        if (bypassRepeat) textsMatch = false;

        // If texts match, update existing placeholder with the canonical messageKey instead of appending
          if (textsMatch) {
            const updated = [...base];
            if ((!last.messageKey && status.messageKey) || status.reasoning) {
              updated[lastIdx] = { 
                ...last, 
                messageKey: status.messageKey || last.messageKey, 
                message: (!status.messageKey ? status.message : undefined) || last.message,
                reasoning: status.reasoning || last.reasoning // 🟢 Capture reasoning update on repeat turns flawlessly
              };
            }
            lastKeyRef.current = key; // mark as handled
            return updated;
          }
      }

      // Otherwise, finalize previous tail (duration since it appeared) and append the new item
      let updated = base;
      if (lastIdx !== -1) {
        const last = base[lastIdx];
        const duration = Math.max(0, Math.floor((now - last.timestamp) / 1000));
        if (duration > last.elapsedSeconds) {
          updated = [...base];
          updated[lastIdx] = { ...last, elapsedSeconds: duration };
        }
      }
      const out = [
        ...updated,
        { 
          id: `${now}-${Math.random()}`, 
          stage: status.stage, 
          message: status.message, 
          messageKey: status.messageKey, 
          reasoning: status.reasoning, // 🟢 Set initial reasoning for new items flaws triggers flawless
          timestamp: now, 
          elapsedSeconds: 0 
        },
      ];
      // If we bypassed de-dup for the repeated 'executing_query', reset the flag now
      if (status.stage === 'execute' && status.messageKey === 'status.executing_query' && allowNextExecuteRepeatRef.current) {
        allowNextExecuteRepeatRef.current = false;
      }
      return out;
    });

    lastKeyRef.current = key;
  }, [status?.stage, status?.messageKey, status?.message, status?.startTime]);

  if (!status) return null;

  const itemsByStage = useMemo(() => {
    const map: Record<string, TimelineItem[]> = { ambiguity: [], generation: [], execute: [] };
    for (const it of items) {
      if (map[it.stage]) map[it.stage].push(it);
    }
    return map;
  }, [items]);

  // Normalize: if stage is not one of the known stages (e.g., 'done' after stream ends),
  // treat it as after the last stage so all stages render as completed and no spinner remains.
  const _idx = STAGES.indexOf(status.stage as any);
  const activeIdx = _idx === -1 ? STAGES.length : _idx;
  const stageLabel = (s: string) => (s === 'ambiguity' ? t('chat.subtle.ambiguity') : s === 'generation' ? t('chat.subtle.generation') : t('chat.subtle.execute'));
  const formatClockTs = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour12: false });

  const MASKED_LOGS: Record<string, string> = {
    'direct_query_fallback': 'chat.searching_kb',
    'budget_query_cost_analysis': 'chat.analyzing_budget',
    'list_maintenance_activities': 'chat.mapping_schedules',
    'fetching_data': 'chat.retrieving_records',
    'executing_query': 'chat.querying_db',
    'analyzing_request': 'status.analyzing',
    'analyzing request': 'status.analyzing',
    're_analyzing': 'status.re_analyzing',
    'orchestrating tools': 'chat.orchestrating_tools',
    'parallel tools': 'chat.executing_tools',
    'observational memory': 'chat.updating_memory',
    'finalizing analysis': 'chat.finalizing_analysis',
    'explaining error': 'chat.explaining_error',
  };

  const getFriendlyText = (raw: string) => {
    const norm = raw.trim().toLowerCase();
    
    // 🟢 Preserve raw text if it contains numbers and tool/result keywords (dynamic logs)
    if (/\d+/.test(raw) && (norm.includes('tool') || norm.includes('result'))) return raw;

    for (const [k, v] of Object.entries(MASKED_LOGS)) {
      if (norm.includes(k.replace(/_/g, ' ').toLowerCase())) return t(v);
    }
    return raw;
  };

  const totalSeconds = items.length > 0 
    ? Math.max(0, Math.floor((nowMs - items[0].timestamp) / 1000)) 
    : 0;

  return (
    <div className="flex w-full justify-start mt-3 mb-1">
      <div className="w-full max-w-4xl bg-white/70 backdrop-blur-sm border border-gray-100/60 rounded-xl shadow-[0_2px_15px_rgb(0,0,0,0.03)] p-4 space-y-4">
        
        {/* Header/Timer */}
        <div className="flex items-center justify-between gap-2 text-gray-700 text-sm font-semibold border-b border-gray-50 pb-2.5 cursor-pointer select-none transition-colors hover:bg-gray-50/30 rounded-t-lg px-1 -mx-1" onClick={() => setIsExpanded(!isExpanded)}>
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
            <span>{t('chat.thought_process')}</span>
          </div>
          <span className="tabular-nums text-[11px] text-gray-400">{totalSeconds}s</span>
        </div>

        {isExpanded && (

        <div className="space-y-2 relative mt-1 pl-1">
          {items.map((it, idx) => {
            const isLast = idx === items.length - 1;
            const textRaw = it.messageKey ? t(it.messageKey) : (it.message ?? '');
            const text = getFriendlyText(textRaw);
            const forcedError = (it as any).forcedError === true;
            const textHasError = (it.messageKey && (it.messageKey.toLowerCase().includes('error') || it.messageKey === 'status.cancelled')) || /^error[:\s]/i.test(it.message || '');
            const iconIsError = forcedError || textHasError;
            const isActive = !iconIsError && isLast && status.stage !== 'done';
            const elapsed = isActive 
              ? Math.max(it.elapsedSeconds, Math.floor((nowMs - it.timestamp) / 1000)) 
              : it.elapsedSeconds;

            return (
              <div key={it.id} className="relative">
                {/* Visual Connector Line between nodes */}
                {/* Visual Connector Line between nodes */}
                {!isLast && (
                  <div className="absolute left-[13px] top-8 h-full w-[1.5px] bg-gray-50" style={{ zIndex: 1 }}></div>
                )}

                <div className={`flex items-start gap-3 p-2 rounded-lg transition-all ${isActive ? 'bg-gray-50/50 font-medium' : iconIsError ? 'bg-red-50/10 border border-red-100/20' : 'bg-transparent'}`} style={{ zIndex: 10, position: 'relative' }}>
                  {isActive ? (
                    <div className="p-1 rounded-full bg-white shadow-sm ring-1 ring-gray-100 flex-shrink-0 mt-0.5">
                      <Loader2 className="w-4 h-4 text-black animate-spin" />
                    </div>
                  ) : iconIsError ? (
                    <div className="p-1 rounded-full bg-red-50 flex-shrink-0 mt-0.5">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                    </div>
                  ) : (
                    <div className="p-1 rounded-full bg-black flex-shrink-0 mt-0.5">
                      <Check className="w-4 h-4 text-white" strokeWidth={2.5} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0 mt-0.5">
                    <span className={`text-[13px] font-medium ${iconIsError ? 'text-red-800' : isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                      {text}
                    </span>
                    
                    {/* 🟢 Reasoning / CoT Chain Display flawlessly trigger */}
                    {it.reasoning && !iconIsError && (
                      <div className="text-[12px] leading-relaxed text-gray-500 mt-2 border-l border-gray-100 pl-3 py-1.5 bg-gray-50/30 rounded-r-md">
                        {it.reasoning}
                      </div>
                    )}

                    {iconIsError && it.message && it.message !== textRaw && (
                      <div className="text-xs text-gray-500 mt-1.5 bg-gray-50 border border-gray-100/80 rounded-lg px-2.5 py-1.5 max-w-fit shadow-sm">
                        {it.message.replace(/^error:?\s*/i, '')}
                      </div>
                    )}
                  </div>

                  <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                    {elapsed}s
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        )}

      </div>
    </div>
  );
};

export default StreamingTimeline;

