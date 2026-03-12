import React from 'react';
import { useTranslation } from 'react-i18next';

export type HitlSummaryProps = { conversation: any };

const HitlSummary: React.FC<HitlSummaryProps> = ({ conversation }) => {
  const { t } = useTranslation();

  const questions = conversation?.disambiguationLog?.clarifyingQuestions || conversation?.clarifyingQuestions || [];
  const assumptions = conversation?.disambiguationLog?.assumptions || conversation?.assumptions || [];
  const responses = conversation?.disambiguationLog?.userResponses || [];

  const originalQuery = conversation?.originalQuery || conversation?.disambiguationLog?.originalQuery || conversation?.userQuery;
  const resolvedQuery = conversation?.disambiguationLog?.resolvedQuery || conversation?.resolvedQuery;

  return (
    <div className="flex-1 flex flex-col card">
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">{t('request.disambiguation')}</h2>
        </div>
        <div className="space-y-6">
          {originalQuery && (
            <div className="p-3 rounded border bg-purple-50 border-purple-200">
              <span className="text-sm font-semibold text-purple-800">{t('disambiguation.your_original_question')}</span>
              <div className="mt-1"><p className="text-sm text-gray-800 ml-4">"{originalQuery}"</p></div>
            </div>
          )}

          <div>
            <h3 className="sr-only">{t('request.disambiguation')}</h3>
            <div className="space-y-4">
              {questions.length > 0 && (
                <div className="p-3 rounded border bg-yellow-50 border-yellow-200">
                  <span className="text-sm font-semibold text-yellow-800">{t('request.questions_asked')}</span>
                  <ul className="mt-1 space-y-1">{questions.map((q: string, i: number)=> (<li key={i} className="text-sm text-gray-800 ml-4">• {q}</li>))}</ul>
                </div>
              )}

              {assumptions.length > 0 && (
                <div className="p-3 rounded border bg-blue-50 border-blue-200">
                  <span className="text-sm font-semibold text-blue-800">{t('request.assumptions_shown')}</span>
                  <ul className="mt-1 space-y-1">{assumptions.map((a: string, i: number)=> (<li key={i} className="text-sm text-gray-800 ml-4">• {a}</li>))}</ul>
                </div>
              )}

              {responses.length > 0 && (
                <div className="p-3 rounded border bg-green-50 border-green-200">
                  <span className="text-sm font-semibold text-green-800">{t('request.your_responses')}</span>
                  <ul className="mt-1 space-y-1">{responses.map((r: string, i: number)=> (<li key={i} className="text-sm text-gray-800 ml-4">• {r}</li>))}</ul>
                </div>
              )}

              {resolvedQuery && (
                <div className="p-3 rounded border bg-gray-50 border-gray-200">
                  <span className="text-sm font-semibold text-gray-800">{t('request.resolved_query')}</span>
                  <div className="mt-1"><p className="text-sm text-gray-700 ml-4">"{resolvedQuery}"</p></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HitlSummary;

