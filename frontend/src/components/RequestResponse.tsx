import React, { useState } from 'react';
import { Pin, PinOff, Copy, Download, ChevronDown, ChevronRight, Database, Clock, CheckCircle, AlertCircle, Code, Table, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AIResultsView from '@/components/ai-results/AIResultsView';
import apiService from '@/services/api.service';

export type RequestResponseProps = {
  conversation: any;
  onUpdate: (c: any) => void;
  onOpenRelated?: (id: string) => void;
};

const RequestResponse: React.FC<RequestResponseProps> = ({ conversation, onUpdate, onOpenRelated }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'results'|'query'|'metadata'>('results');
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);

  const handleTogglePin = async () => {
    setIsUpdatingPin(true);
    try {
      await apiService.togglePin(conversation.conversationId, !conversation.isPinned);
      onUpdate({ ...conversation, isPinned: !conversation.isPinned });
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    } finally {
      setIsUpdatingPin(false);
    }
  };

  const normalizedText = conversation.resolvedQuery || conversation.normalizedRequest || conversation.userQuery;

  const [copiedToast, setCopiedToast] = useState<string|null>(null);
  const showCopied = (msg?: string) => {
    setCopiedToast(msg || (t('disambiguation.copied') as string));
    window.setTimeout(() => setCopiedToast(null), 1200);
  };
  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showCopied(); } catch {}
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
      link.download = `phoenixai-results-${conversation.conversationId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleString();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error': return <AlertCircle className="w-5 h-5 text-red-600" />;
      default: return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return t('status.completed');
      case 'error': return t('status.error');
      case 'disambiguating':
      case 'ambiguous': return t('status.hitl_disambiguation');
      default: return t('status.processing');
    }
  };

  return (
    <>
      <div className="flex-1 min-w-0 flex flex-col card">
        <div className="border-b border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                {getStatusIcon(conversation.status)}
                <h2 className="text-lg font-semibold text-gray-900">{getStatusText(conversation.status)}</h2>
                <span className="text-sm text-gray-500">{formatDate(conversation.createdAt)}</span>
              </div>

              {/* {conversation.status !== 'error' && conversation.relatedConversationId && (
                <div className="mt-2">
                  <span className="text-xs text-gray-500">{t('request.final_text_sent')}:</span>
                  <pre className="p-2 bg-gray-50 border border-gray-200 rounded text-xs overflow-auto font-mono text-gray-800 whitespace-pre-wrap break-words break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{conversation?.resolvedQuery || conversation?.normalizedRequest || conversation?.userQuery || ''}</pre>
                </div>
              )} */}

              {conversation.status === 'error' && conversation.error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                  <pre className="text-sm text-red-700 whitespace-pre-wrap break-words">{String(conversation.error)}</pre>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">{t('request.original_query')}</label>
                    <button type="button" className="btn-ghost text-xs px-2 py-1" title={t('request.copy_original') as string} onClick={() => handleCopy(String(conversation.userQuery || ''))}>
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <pre className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm overflow-auto font-mono text-gray-800 whitespace-pre-wrap break-words break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{conversation.userQuery}</pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">{t('request.normalized_query')}</label>
                    <div className="flex items-center gap-2">
                      {normalizedText === conversation.userQuery && (<span className="badge badge-info">{t('request.same_as_original')}</span>)}
                      <button type="button" className="btn-ghost text-xs px-2 py-1" title={t('request.copy_normalized') as string} onClick={() => handleCopy(String(normalizedText || ''))}>
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm overflow-auto font-mono text-gray-800 whitespace-pre-wrap break-words break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{normalizedText}</pre>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 ml-4">
              {(conversation.relatedConversationId && (conversation.status === 'completed' || conversation.status === 'error')) && (
                <button onClick={() => onOpenRelated?.(conversation.relatedConversationId)} className="btn-ghost text-xs px-2 py-1 mr-2" title={t('app.view_hitl') as string}>
                  {t('app.view_hitl')}
                </button>
              )}

              <button onClick={handleTogglePin} disabled={isUpdatingPin} className={`p-2 rounded-lg transition-colors ${conversation.isPinned ? 'bg-primary-100 text-primary-600 hover:bg-primary-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {conversation.isPinned ? (<PinOff className="w-4 h-4" />) : (<Pin className="w-4 h-4" />)}
              </button>

              <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
                {isExpanded ? (<ChevronDown className="w-4 h-4" />) : (<ChevronRight className="w-4 h-4" />)}
              </button>
            </div>
          </div>

          {isExpanded && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {conversation.executionMetadata && (
                <>
                  <div className="flex items-center space-x-2"><Database className="w-4 h-4 text-gray-400" /><span className="text-gray-600">{conversation.executionMetadata.resultCount || 0} {t('app.results_label')}</span></div>
                  <div className="flex items-center space-x-2"><Clock className="w-4 h-4 text-gray-400" /><span className="text-gray-600">{conversation.executionMetadata.executionTimeMs || 0}ms</span></div>
                </>
              )}
              {conversation.generatedQuery?.base_collection && (
                <div className="flex items-center space-x-2"><Database className="w-4 h-4 text-gray-400" /><span className="text-gray-600">{conversation.generatedQuery.base_collection}</span></div>
              )}
            </div>
          )}
        </div>

      {isExpanded && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              <button onClick={() => setActiveTab('results')} className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'results' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <div className="flex items-center space-x-2"><Table className="w-4 h-4" /><span>{t('request.tabs.results')}</span></div>
              </button>
              <button onClick={() => setActiveTab('query')} className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'query' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <div className="flex items-center space-x-2"><Code className="w-4 h-4" /><span>{t('request.tabs.query')}</span></div>
              </button>
              <button onClick={() => setActiveTab('metadata')} className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'metadata' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                <div className="flex items-center space-x-2"><FileText className="w-4 h-4" /><span>{t('request.tabs.details')}</span></div>
              </button>
            </nav>
          </div>

          <div>
            {activeTab === 'results' && (
              <div className="flex flex-col min-w-0">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <h3 className="font-medium text-gray-900">{t('request.query_results')}</h3>
                  <button onClick={handleDownloadResults} className="btn-ghost flex items-center space-x-2" disabled={!conversation.results}>
                    <Download className="w-4 h-4" /><span>{t('request.download')}</span>
                  </button>
                </div>
                <div className="overflow-x-auto w-full max-w-full">
                  <AIResultsView
                    results={conversation.results || []}
                    query={conversation.generatedQuery}
                    showIdsDefault={false}
                    onToggleShowIds={() => {}}
                    conversation={conversation}
                    onViewHitl={onOpenRelated}
                    dualViewConfig={conversation.dualViewConfig}
                  />
                </div>
              </div>
            )}

            {activeTab === 'query' && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <h3 className="font-medium text-gray-900">{t('request.generated_query')}</h3>
                  <button onClick={handleCopyQuery} className="btn-primary flex items-center space-x-2" disabled={!conversation.generatedQuery?.pipeline}>
                    <Copy className="w-4 h-4" /><span>{t('request.copy')}</span>
                  </button>
                </div>
                <div className="p-4">
                  {conversation.generatedQuery ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t('request.base_collection')}</label>
                        <code className="block p-3 bg-gray-100 rounded-lg text-sm">{conversation.generatedQuery.base_collection}</code>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t('request.aggregation_pipeline')}</label>
                        <pre className="p-4 bg-gray-900 text-green-400 rounded-lg text-sm overflow-x-auto font-mono whitespace-pre">{JSON.stringify(conversation.generatedQuery.pipeline, null, 2)}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">{t('request.no_query')}</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'metadata' && (
              <div className="p-4">
                <div className="space-y-6">
                  {conversation.selectedIntents && conversation.selectedIntents.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">{t('request.selected_intents')}</h4>
                      <div className="space-y-2">
                        {conversation.selectedIntents.map((intent: any, index: number) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><span className="font-medium">{intent.intent}</span><span className="text-sm text-gray-500">{t('request.confidence', { value: Math.round(intent.confidence * 100) })}</span></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {conversation.targetCollections && conversation.targetCollections.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">{t('request.target_collections')}</h4>
                      <div className="flex flex-wrap gap-2">
                        {conversation.targetCollections.map((collection: string, index: number) => (<span key={index} className="badge badge-info">{collection}</span>))}
                      </div>
                    </div>
                  )}

                  {(conversation.ambiguityResolution?.isAmbiguous || conversation.disambiguationLog) && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">{t('request.disambiguation')}</h4>
                      <div className="space-y-3">
                        {((conversation.ambiguityResolution?.clarifyingQuestions?.length ?? 0) > 0 || (conversation.disambiguationLog?.clarifyingQuestions?.length ?? 0) > 0) && (
                          <div>
                            <span className="text-sm font-medium text-gray-700">{t('request.questions_asked')}</span>
                            <ul className="mt-1 space-y-1">
                              {(conversation.disambiguationLog?.clarifyingQuestions || conversation.ambiguityResolution?.clarifyingQuestions || []).map((question: string, index: number) => (<li key={index} className="text-sm text-gray-600 ml-4">• {question}</li>))}
                            </ul>
                          </div>
                        )}
                        {((conversation.ambiguityResolution?.assumptions?.length ?? 0) > 0 || (conversation.disambiguationLog?.assumptions?.length ?? 0) > 0) && (
                          <div>
                            <span className="text-sm font-medium text-gray-700">{t('request.assumptions_shown')}</span>
                            <ul className="mt-1 space-y-1">
                              {(conversation.disambiguationLog?.assumptions || conversation.ambiguityResolution?.assumptions || []).map((a: string, idx: number) => (<li key={idx} className="text-sm text-gray-600 ml-4">• {a}</li>))}
                            </ul>
                          </div>
                        )}
                        {((conversation.ambiguityResolution?.userResponses?.length ?? 0) > 0 || (conversation.disambiguationLog?.userResponses?.length ?? 0) > 0) && (
                          <div>
                            <span className="text-sm font-medium text-gray-700">{t('request.your_responses')}</span>
                            <ul className="mt-1 space-y-1">
                              {(conversation.disambiguationLog?.userResponses || conversation.ambiguityResolution?.userResponses || []).map((response: string, index: number) => (<li key={index} className="text-sm text-gray-600 ml-4">• {response}</li>))}
                            </ul>
                          </div>
                        )}
                        {conversation.disambiguationLog?.resolvedQuery && (
                          <div>
                            <span className="text-sm font-medium text-gray-700">{t('request.resolved_query')}</span>
                            <div className="p-3 bg-gray-50 rounded-lg border"><pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">{conversation.disambiguationLog.resolvedQuery}</pre></div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>

      {copiedToast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-sm px-3 py-2 rounded shadow-lg z-50">
          {copiedToast}
        </div>
      )}
    </>
  );
};

export default RequestResponse;

