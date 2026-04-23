import React, { useState } from 'react';
import { HelpCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface InlineDisambiguationProps {
  conversation: any;
  onComplete: (result: any) => void;
  phoenixUseStream: boolean;
}

const InlineDisambiguation: React.FC<InlineDisambiguationProps> = React.memo(({
  conversation,
  onComplete,
  phoenixUseStream,
}) => {
  const { t } = useTranslation();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const clarifyingQuestions = conversation.clarifyingQuestions || [];
  const assumptions = conversation.assumptions || [];
  const originalQuery = conversation.originalQuery || '';
  const detectedIssues = conversation.detected_issues || [];

  // No local submit flow. We now use the bottom chat input to re-enter the clarified query
  // and start a fresh stream. This component only displays the ambiguity context.

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white/60">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 bg-blue-50 rounded-xl shadow-sm">
            <HelpCircle className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{t('disambiguation.need_more_info')}</h3>
            <p className="text-sm text-gray-600">{t('disambiguation.needs_clarification')}</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-6 bg-transparent">
        {/* Detected Issues */}
        {detectedIssues.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('disambiguation.detected_issues')}
            </label>
            <div className="space-y-3">
              {detectedIssues.map((issue: any, idx: number) => (
                <div key={idx} className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                  <div className="flex items-start gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5" />
                    <div className="text-sm text-gray-800">
                      <span className="font-medium">{issue.category}:</span> {issue.problem}
                    </div>
                  </div>
                  {issue.possible_interpretations && issue.possible_interpretations.length > 0 && (
                    <ul className="list-disc pl-6 text-sm text-gray-700 space-y-1">
                      {issue.possible_interpretations.map((pi: any, piIdx: number) => (
                        <li key={piIdx}>{pi}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Original Query */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('disambiguation.original_query')}
          </label>
          <div className="p-4 bg-white/60 rounded-xl border border-gray-200/60 shadow-sm">
            <p className="text-gray-900 italic font-medium">"{originalQuery}"</p>
          </div>
        </div>

        {/* Clarifying Questions */}
        {clarifyingQuestions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              {t('disambiguation.clarifying_questions')}
            </label>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-800 font-medium">
                {clarifyingQuestions.map((q: string, index: number) => (
                  <li key={index}>{q}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* Assumptions */}
        {assumptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('disambiguation.assumptions_intro')}
            </label>
            <div className="bg-blue-50/50 border border-blue-200/60 rounded-xl p-4 shadow-sm">
              <ul className="text-sm text-blue-800 space-y-1">
                {assumptions.map((assumption: string, index: number) => (
                  <li key={index} className="flex items-start justify-between gap-2">
                    <div className="flex items-start">
                      <span className="text-blue-600 mr-2">•</span>
                      <span>{assumption}</span>
                    </div>
                    <button
                      type="button"
                      className={`btn-ghost text-xs px-2 py-1 ${copiedIndex === index ? 'text-green-700' : ''}`}
                      title={t('disambiguation.copy_suggestion')}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(assumption || ''));
                          setCopiedIndex(index);
                          setTimeout(() => setCopiedIndex(null), 2000);
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

        {/* Instruction to use the main chat input */}
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-600 font-medium flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            {t('disambiguation.reenter_note')}
          </p>
        </div>
      </div>
    </div>
  );
});

export default InlineDisambiguation;

