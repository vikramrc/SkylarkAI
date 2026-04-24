import React, { useState } from 'react';
import { CheckCircle, Table, Code, FileText, Download, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AIResultsView from '@/components/ai-results/AIResultsView';

interface InlineResultsProps {
  conversation: any;
}

const InlineResults: React.FC<InlineResultsProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'results' | 'query' | 'metadata'>('results');
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  const showCopied = (msg?: string) => {
    setCopiedToast(msg || (t('disambiguation.copied') as string));
    setTimeout(() => setCopiedToast(null), 1200);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showCopied();
    } catch {}
  };

  const handleCopyQuery = () => {
    if (conversation.generatedQuery?.pipeline) {
      const queryText = JSON.stringify(conversation.generatedQuery.pipeline, null, 2);
      handleCopy(queryText);
    }
  };

  const handleDownloadResults = () => {
    if (conversation.results) {
      const dataStr = JSON.stringify(conversation.results, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `skylark-results-${conversation.conversationId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const normalizedText =
    conversation.resolvedQuery || conversation.normalizedRequest || conversation.userQuery;

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
        <div className="flex items-center gap-2 p-6 border-b border-gray-200 bg-white/60">
          <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">{t('status.completed')}</p>
            <p className="text-xs text-gray-600">
              {conversation.executionMetadata?.resultCount || 0} {t('app.results_label')} •{' '}
              {conversation.executionMetadata?.executionTimeMs || 0}ms
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
          <nav className="flex p-1 bg-gray-200/50 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('results')}
              className={`py-2 px-4 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === 'results'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Table className="w-4 h-4" />
                <span>{t('request.tabs.results')}</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('query')}
              className={`py-2 px-4 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === 'query'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Code className="w-4 h-4" />
                <span>{t('request.tabs.query')}</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('metadata')}
              className={`py-2 px-4 rounded-lg font-medium text-sm transition-all duration-200 ${
                activeTab === 'metadata'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4" />
                <span>{t('request.tabs.details')}</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'results' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-gray-900">{t('request.query_results')}</h3>
                <button
                  onClick={handleDownloadResults}
                  className="btn-ghost flex items-center space-x-2 text-sm"
                  disabled={!conversation.results}
                >
                  <Download className="w-4 h-4" />
                  <span>{t('request.download')}</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <AIResultsView
                  results={conversation.results || []}
                  query={conversation.generatedQuery}
                  showIdsDefault={false}
                  onToggleShowIds={() => {}}
                  conversation={conversation}
                  onViewHitl={() => {}}
                  dualViewConfig={conversation.dualViewConfig}
                />
              </div>
            </div>
          )}

          {activeTab === 'query' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-gray-900">{t('request.generated_query')}</h3>
                <button
                  onClick={handleCopyQuery}
                  className="btn-primary flex items-center space-x-2 text-sm"
                  disabled={!conversation.generatedQuery?.pipeline}
                >
                  <Copy className="w-4 h-4" />
                  <span>{t('request.copy')}</span>
                </button>
              </div>
              {conversation.generatedQuery ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('request.base_collection')}
                    </label>
                    <code className="block p-3 bg-gray-100 rounded-lg text-sm">
                      {conversation.generatedQuery.base_collection}
                    </code>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('request.aggregation_pipeline')}
                    </label>
                    <pre className="p-4 bg-gray-900 text-green-400 rounded-lg text-sm overflow-x-auto font-mono whitespace-pre">
                      {JSON.stringify(conversation.generatedQuery.pipeline, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">{t('request.no_query')}</div>
              )}
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className="space-y-6">
              {/* Original and Normalized Queries */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      {t('request.original_query')}
                    </label>
                    <button
                      type="button"
                      className="btn-ghost text-xs px-2 py-1"
                      onClick={() => handleCopy(String(conversation.userQuery || ''))}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <pre className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm overflow-auto font-mono text-gray-800 whitespace-pre-wrap break-words">
                    {conversation.userQuery}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      {t('request.normalized_query')}
                    </label>
                    <button
                      type="button"
                      className="btn-ghost text-xs px-2 py-1"
                      onClick={() => handleCopy(String(normalizedText || ''))}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <pre className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm overflow-auto font-mono text-gray-800 whitespace-pre-wrap break-words">
                    {normalizedText}
                  </pre>
                </div>
              </div>

              {/* Selected Intents */}
              {conversation.selectedIntents && conversation.selectedIntents.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">{t('request.selected_intents')}</h4>
                  <div className="space-y-2">
                    {conversation.selectedIntents.map((intent: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <span className="font-medium">{intent.intent}</span>
                        <span className="text-sm text-gray-500">
                          {t('request.confidence', { value: Math.round(intent.confidence * 100) })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Collections */}
              {conversation.targetCollections && conversation.targetCollections.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">{t('request.target_collections')}</h4>
                  <div className="flex flex-wrap gap-2">
                    {conversation.targetCollections.map((collection: string, index: number) => (
                      <span key={index} className="badge badge-info">
                        {collection}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {copiedToast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-sm px-3 py-2 rounded shadow-lg z-50">
          {copiedToast}
        </div>
      )}
    </>
  );
};

export default InlineResults;

