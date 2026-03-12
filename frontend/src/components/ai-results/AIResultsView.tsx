import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ResultDisplay from '../ResultDisplay';
import type { ResultDisplayProps } from '../ResultDisplay';
import { ResultRenderer } from './ResultRenderer';
import { classifyByBase, splitIntoSections } from './utils/classify';
import DualViewToggle, { type DualViewConfig } from './DualViewToggle';
import { transformResultsForView, getRendererForView } from './utils/dualViewTransform';
import { SafeTableContainer } from './SafeTableContainer';

export type AIResultsViewProps = ResultDisplayProps & {
  defaultView?: 'cards' | 'table' | 'json';
  dualViewConfig?: DualViewConfig;
};

const typeLabels: Record<string, string> = {
  work_history: 'aiResults.section.work_history',
  document: 'aiResults.section.documents',
  form_template: 'aiResults.section.form_templates',
  form: 'aiResults.section.forms',
  schedule: 'aiResults.section.schedule',
  inventory_usage: 'aiResults.section.inventory_usage',
  tag: 'aiResults.section.tag',
  other: 'aiResults.section.other',
};

function groupByType(results: any[]) {
  const groups: Record<string, any[]> = {};
  (results || []).forEach((r) => {
    const t = (r && typeof r.type === 'string' && r.type) || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  });
  return groups;
}

const AIResultsView: React.FC<AIResultsViewProps> = (props) => {
  const { results, query, dualViewConfig } = props;
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'json'>(props.defaultView || 'cards');

  // Dual-view state: track which view is active
  const [activeCollectionView, setActiveCollectionView] = useState<string>(
    dualViewConfig?.defaultView || query?.base_collection || ''
  );

  // Transform results based on active view
  const transformedResults = useMemo(() => {
    if (!dualViewConfig?.available) {
      return results;
    }
    return transformResultsForView(results, activeCollectionView, query?.base_collection || '');
  }, [results, activeCollectionView, dualViewConfig, query?.base_collection]);

  // Get the effective base type for classification
  const effectiveBaseCollection = useMemo(() => {
    if (dualViewConfig?.available) {
      return getRendererForView(activeCollectionView, query?.base_collection || '');
    }
    return query?.base_collection;
  }, [activeCollectionView, dualViewConfig, query?.base_collection]);

  const baseType = useMemo(() => classifyByBase(effectiveBaseCollection), [effectiveBaseCollection]);
  const raw = useMemo(() => (Array.isArray(transformedResults) && transformedResults.length === 1 && typeof transformedResults[0] === 'object' && !Array.isArray(transformedResults[0]) ? transformedResults[0] : transformedResults), [transformedResults]);
  const { sections, primaryIdx } = useMemo(() => splitIntoSections(raw, baseType), [raw, baseType]);
  const orderedSections = useMemo(() => {
    if (!Array.isArray(sections)) return [] as any[];
    const arr = sections.slice();
    // Move primary to front
    if (primaryIdx >= 0 && primaryIdx < arr.length) {
      const [p] = arr.splice(primaryIdx, 1);
      arr.unshift(p);
    }
    // Sort remaining by size desc (keep primary first)
    const primary = arr[0];
    const rest = arr.slice(1).sort((a:any,b:any)=> (b.items?.length||0) - (a.items?.length||0));
    return [primary, ...rest].filter(Boolean);
  }, [sections, primaryIdx]);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <div className="flex items-center space-x-1 bg-white rounded-lg border border-gray-200 p-1">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1 text-sm rounded transition-colors ${viewMode === 'cards' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {t('aiResults.cards')}
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-sm rounded transition-colors ${viewMode === 'table' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {t('result.table')}
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`px-3 py-1 text-sm rounded transition-colors ${viewMode === 'json' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {t('result.json')}
            </button>
          </div>
        </div>
        {viewMode === 'cards' && (
          <div className="text-xs text-gray-600">
            {/* CTA to see the old table view */}
            <button className="underline hover:no-underline" onClick={() => setViewMode('table')}>
              {t('aiResults.switch_to_table')}
            </button>
          </div>
        )}
      </div>

      {/* Body */}


      {viewMode === 'table' && (
        <SafeTableContainer>
          <ResultDisplay {...props} />
        </SafeTableContainer>
      )}

      {viewMode === 'json' && (
        <div className="p-4">
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {JSON.stringify(results || [], null, 2)}
          </pre>
        </div>
      )}

      {viewMode === 'cards' && (
        <div className="p-3 space-y-4">
          {/* Dual-View Toggle */}
          {dualViewConfig?.available && (
            <DualViewToggle
              config={dualViewConfig}
              activeView={activeCollectionView}
              onViewChange={setActiveCollectionView}
              showInfoBanner={true}
            />
          )}

          {(!orderedSections || orderedSections.length === 0) && (
            <div className="text-sm text-gray-600">{t('result.none_display')}</div>
          )}
          {orderedSections.map((sec, idx) => {
            const typeKey = sec?.type || 'other';
            const isPrimary = idx === 0 && (!!baseType && typeKey === baseType);
            return (
              <div key={`${typeKey}-${idx}`} className={`space-y-2 ${isPrimary ? 'pl-3 border-l-4 border-primary-600/70' : ''}`}>
                <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <span>{t(typeLabels[typeKey] || typeLabels.other)}</span>
                  <span className="text-gray-400">({sec.items?.length || 0})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(sec.items || []).map((r: any, i: number) => (
                    <ResultRenderer key={r?.id || i} r={r} itemType={typeKey} onRequestSwitchToTable={() => setViewMode('table')} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AIResultsView;

