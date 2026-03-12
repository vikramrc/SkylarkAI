import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Vertical, centered timeline that ACCUMULATES events per stage (tree view)
// Messages never vanish; duplicates are suppressed per (stage|messageKey|message)

export type StreamingStatus = {
  stage: 'ambiguity' | 'generation' | 'execute' | string;
  message?: string;
  messageKey?: string;
  startTime: number;
  activityLevel?: number;
  tokenCount?: number;
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
          if (!last.messageKey && status.messageKey) {
            updated[lastIdx] = { ...last, messageKey: status.messageKey, message: undefined };
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
        { id: `${now}-${Math.random()}`, stage: status.stage, message: status.message, messageKey: status.messageKey, timestamp: now, elapsedSeconds: 0 },
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

  return (
    <div className="flex justify-center mt-4">
      <div className="w-full max-w-2xl space-y-6">
        {STAGES.map((stage, idx) => {
          const active = status.stage === stage;
          const completed = activeIdx > -1 && idx < activeIdx;
          const stageItems = itemsByStage[stage] || [];
          return (
            <div key={stage} className="space-y-2 relative">
              <div className="flex items-center gap-3">
                {active ? (
                  <span className={['orb','orb-smooth', 'animate-pulse-glow', (status.activityLevel ?? 0) >= 4 ? 'glow-3' : (status.activityLevel ?? 0) >= 3 ? 'glow-2' : (status.activityLevel ?? 0) >= 2 ? 'glow-1' : 'glow-0'].join(' ')} />
                ) : completed ? (
                  <svg className="w-7 h-7 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <span className="inline-block w-7 h-7 rounded-full border-2 border-gray-300" />
                )}
                <span className={`text-base font-semibold ${active ? 'text-primary-700' : completed ? 'text-green-700' : 'text-gray-500'}`}>{stageLabel(stage)}</span>
              </div>

              {/* Connector Line */}
              {idx < STAGES.length - 1 && (
                <div className={`absolute left-[14px] top-8 bottom-0 w-0.5 -ml-px h-full ${completed ? 'bg-green-200' : 'bg-gray-200'}`} style={{ height: 'calc(100% + 8px)', zIndex: -1 }}></div>
              )}

              {stageItems.length > 0 && (
                <div className="ml-3.5 pl-6 border-l-2 border-transparent space-y-2 relative">
                  {stageItems.map((it, i) => {
                    const isLast = i === stageItems.length - 1;
                    const next = !isLast ? stageItems[i + 1] : undefined;
                    const isActiveMessage = active && isLast;
                    const text = it.messageKey ? t(it.messageKey) : (it.message ?? '');
                    const forcedError = (it as any).forcedError === true;
                    const textHasError = (it.messageKey && (it.messageKey.toLowerCase().includes('error') || it.messageKey === 'status.cancelled')) || /^error[:\s]/i.test(it.message || '');
                    const iconIsError = forcedError || textHasError;
                    const showSpinner = isActiveMessage && !iconIsError; // spinner for the latest item until a new one arrives
                    // For non-last items within the same stage, compute seconds from this item's timestamp to the next item's timestamp.
                    const betweenMsgSeconds = next ? Math.max(0, Math.floor((next.timestamp - it.timestamp) / 1000)) : undefined;
                    const displaySeconds = showSpinner
                      ? Math.max(it.elapsedSeconds, Math.max(0, Math.floor((nowMs - it.timestamp) / 1000)))
                      : (betweenMsgSeconds ?? it.elapsedSeconds);
                    return (
                      <div key={it.id} className="flex items-center gap-2 animate-fade-in-up">
                        <span className="text-gray-400 text-sm">{isLast ? '\u2514\u2500\u2500' : '\u251c\u2500\u2500'}</span>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`text-sm ${textHasError ? 'text-red-700' : 'text-gray-900'} whitespace-pre-wrap break-words`}>{text}</span>
                          {iconIsError ? (
                            <svg className="w-3.5 h-3.5 text-red-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          ) : showSpinner ? (
                            <span className="text-sm inline-flex items-center" style={{ color: '#8b5cf6', lineHeight: 'inherit', position: 'relative', top: '1px' }} aria-hidden="true">{SPINNER_FRAMES[spinnerFrame]}</span>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-green-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><polyline points="20 6 9 17 4 12" /></svg>
                          )}
                          <span className="text-xs text-gray-500 ml-auto tabular-nums whitespace-nowrap flex-shrink-0">{formatClockTs(it.timestamp)} · {displaySeconds}s</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StreamingTimeline;

