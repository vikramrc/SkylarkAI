
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  isLoading: boolean;
  useStreaming: boolean;
  subtleStatus: string;
  heartbeatCount?: number;
  activityLevel?: number;
  className?: string;
  statusMessage?: string;
  statusMessageKey?: string;
  elapsedSeconds?: number;
  tokenCount?: number;
};

// Node-style spinner frames: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
//| / - \ | / - \ | / - \
// const SPINNER_FRAMES = ['|', '/', '-', '\\', '|', '/', '-', '\\'];
//01010110 01010101 01010100 01010100
// const SPINNER_FRAMES = [0,1,0,1,0,1,1,0, ,0,1,0,1,0,1,0,1, ,0,1,0,1,0,1,0,0, ,0,1,0,1,0,1,0,0];

// Special messages with minimum display duration (milliseconds)
const SPECIAL_MESSAGE_DURATIONS: Record<string, number> = {
  'status.re_analyzing': 1000,              // 1 second
  'status.finalizing_results': 1000,        // 1 second
  'status.no_ambiguity': 1000,              // 1 second
  'status.intent_identified': 1000,         // 1 second
  'status.identifying_interpretations': 1000, // 1 second
  'status.preparing_questions': 1000,       // 1 second
  'status.preparing_suggestions': 1000,     // 1 second
  'status.detected_ambiguity': 1000,        // 1 second
};

const StreamingProgress: React.FC<Props> = ({
  isLoading,
  useStreaming,
  subtleStatus,
  heartbeatCount = 0,
  activityLevel = 0,
  className = 'mt-2',
  statusMessage,
  statusMessageKey,
  elapsedSeconds = 0,
  tokenCount = 0,
}) => {
  const { t } = useTranslation();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [displayedMessageKey, setDisplayedMessageKey] = useState<string | undefined>(statusMessageKey);
  const [displayedMessage, setDisplayedMessage] = useState<string | undefined>(statusMessage);
  const messageTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastExecuteTimeRef = useRef<number>(0);

  // Animate spinner when in generation stage
  useEffect(() => {
    if (subtleStatus === 'generation' && isLoading) {
      const interval = setInterval(() => {
        setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
      }, 80); // 80ms per frame for smooth animation
      return () => clearInterval(interval);
    }
  }, [subtleStatus, isLoading]);

  // Handle special messages with minimum display duration
  useEffect(() => {
    // Clear any existing timer
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }

    // Track when "executing_query" appears to inject "finalizing_results" later
    if (statusMessageKey === 'status.executing_query') {
      lastExecuteTimeRef.current = Date.now();
    }

    // Check if incoming message is a special message
    const minDuration = statusMessageKey ? SPECIAL_MESSAGE_DURATIONS[statusMessageKey] : undefined;

    if (minDuration) {
      // Special message - enforce minimum display duration
      setDisplayedMessageKey(statusMessageKey);
      setDisplayedMessage(statusMessage);

      // Set timer to allow next message after minimum duration
      messageTimerRef.current = setTimeout(() => {
        messageTimerRef.current = null;
      }, minDuration);
    } else {
      // Regular message - check if we need to wait for special message timer
      if (messageTimerRef.current) {
        // Special message is still displaying, queue this message
        // (Timer will clear itself, then this effect will re-run)
        return;
      }

      // Check if we should inject "finalizing_results" after "executing_query"
      if (
        lastExecuteTimeRef.current > 0 &&
        statusMessageKey !== 'status.executing_query' &&
        statusMessageKey !== 'status.finalizing_results' &&
        !isLoading // Results are about to be shown
      ) {
        // Inject "finalizing_results" for 1 second before showing results
        setDisplayedMessageKey('status.finalizing_results');
        setDisplayedMessage(undefined);

        messageTimerRef.current = setTimeout(() => {
          messageTimerRef.current = null;
          setDisplayedMessageKey(statusMessageKey);
          setDisplayedMessage(statusMessage);
          lastExecuteTimeRef.current = 0; // Reset
        }, SPECIAL_MESSAGE_DURATIONS['status.finalizing_results']);
      } else {
        // Normal message - display immediately
        setDisplayedMessageKey(statusMessageKey);
        setDisplayedMessage(statusMessage);
      }
    }

    // Cleanup on unmount
    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
    };
  }, [statusMessageKey, statusMessage, isLoading]);

  // Determine display message with time-based fallbacks
  const getDisplayMessage = () => {
    // Use displayed message (which may be delayed for special messages)
    if (displayedMessageKey) return t(displayedMessageKey);
    if (displayedMessage) return displayedMessage;

    // Time-based fallback messages to prevent blank stream bar
    if (!isLoading) return '';

    if (elapsedSeconds < 2) {
      return t('status.accepting_request');
    } else {
      return t('status.analyzing_response');
    }
  };

  const displayMessage = getDisplayMessage();

  if (!isLoading || !useStreaming) return null;

  const stages: Array<'ambiguity'|'generation'|'execute'> = ['ambiguity','generation','execute'];
  const activeIdx = stages.indexOf(subtleStatus as any);

  return (
    <div className={className}>
      {/* Stage indicators with orbs - centered */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-6 text-sm">
          {stages.map((stage) => {
            const active = subtleStatus === stage;
            const completed = activeIdx > -1 && stages.indexOf(stage) < activeIdx;
            const label = stage === 'ambiguity' ? t('chat.subtle.ambiguity')
                         : stage === 'generation' ? t('chat.subtle.generation')
                         : t('chat.subtle.execute');
            return (
              <div key={stage} className="flex items-center gap-2">
                {active ? (
                  <span
                    className={[
                      'orb','orb-smooth',
                      activityLevel >= 4 ? 'glow-3' :
                      activityLevel >= 3 ? 'glow-2' :
                      activityLevel >= 2 ? 'glow-1' :
                      activityLevel >= 1 ? 'glow-1' : 'glow-0'
                    ].join(' ')}
                    aria-label={t('chat.subtle.active')}
                  />
                ) : completed ? (
                  <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="inline-block w-5 h-5" aria-hidden="true" />
                )}

                <span className={`${active ? 'text-primary-700 font-medium' : completed ? 'text-green-700' : 'text-gray-600'}`}>{label}</span>
              </div>
            );
          })}
        </div>
        {/* Subtle heartbeat counter for debugging/UX parity; hidden visually by default */}
        <div className="sr-only" aria-live="polite">{heartbeatCount}</div>
      </div>

      {/* Stream bar with status messages - centered */}
      {displayMessage && (
        <div className="flex justify-center mt-3">
          <div
            className="flex items-center justify-between px-4 py-2 rounded-md bg-transparent border border-gray-200/50 text-sm max-w-2xl w-full"
            style={{ backdropFilter: 'blur(2px)' }}
          >
            <span className="text-gray-600 flex-1 text-center inline-flex items-center justify-center gap-2">
              <span>{displayMessage}</span>
              {subtleStatus === 'generation' && displayedMessageKey === 'status.assembling_query' && (
                <span className="text-sm  inline-flex items-center"
                      style={{ color: '#8b5cf6', lineHeight: 'inherit' }}
                      aria-hidden="true">
                  {SPINNER_FRAMES[spinnerFrame]}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2 border-l border-gray-300 pl-3 min-w-[90px] justify-end text-xs text-gray-600">
              <span className=" tabular-nums">{elapsedSeconds}s</span>
              <span className=" tabular-nums">{tokenCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreamingProgress;

