import React from 'react';

export type StreamingStatus = {
  stage: 'ambiguity' | 'generation' | 'execute' | string;
  message?: string;
  messageKey?: string;
  startTime: number;
  activityLevel?: number;
  tokenCount?: number;
};

interface Props { status: StreamingStatus | null; }

const StreamingTimeline: React.FC<Props> = ({ status }) => {
  if (!status) return null;
  
  // Hide the orb once the process concludes
  if (status.stage === 'done' || status.stage === 'completed' || status.stage === 'error') {
    return null;
  }

  return (
    <div className="flex justify-start mt-2 mb-4 w-full max-w-[65%]">
       <div className="flex items-center mt-2 ml-1">
          <span className={['orb', 'orb-smooth', 'animate-pulse-glow', (status.activityLevel ?? 0) >= 4 ? 'glow-3' : (status.activityLevel ?? 0) >= 3 ? 'glow-2' : (status.activityLevel ?? 0) >= 2 ? 'glow-1' : 'glow-0'].join(' ')} />
       </div>
    </div>
  );
};

export default StreamingTimeline;
