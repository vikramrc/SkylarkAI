import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import TagPanelDelegate, { type TagPanelHandle } from '../dialogs/TagPanelDelegate';
import GenericCard from './GenericCard';

export default function TagCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const panelRef = useRef<TagPanelHandle>(null);

  // Check sourceMeta for required IDs - if missing, fallback to GenericCard
  const orgId = r?.sourceMeta?.organizationID;
  const tagId = r?.sourceMeta?.entities?.searchableTagId || r?._id;
  const hasSourceMeta = !!(r?.sourceMeta && orgId && tagId);

  if (!hasSourceMeta) {
    return <GenericCard r={r} displayType="tag" />;
  }

  const tagName = (r?.tagName || 'Unknown Tag') as string;
  const tagColor = (r?.tagColor || '#1976d2') as string;
  const taggedItems = Array.isArray(r?.taggedItems) ? r.taggedItems : [];
  const itemCount = taggedItems.length;

  // Count items by type (exclude FormTemplate)
  const formCount = taggedItems.filter((item: any) => item.itemType === 'Form').length;
  const awhCount = taggedItems.filter((item: any) => item.itemType === 'ActivityWorkHistory').length;
  const docCount = taggedItems.filter((item: any) => item.itemType === 'DocumentMetadata').length;

  return (
    <>
      <div className="border border-[rgba(202,206,214,0.5)] rounded-lg p-3 bg-white hover:shadow-sm transition flex flex-col w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-md border shrink-0"
                style={{
                  backgroundColor: `${tagColor}15`,
                  borderColor: tagColor,
                  color: tagColor,
                }}
              >
                <Tag className="w-3.5 h-3.5" />
              </span>
              <div className="text-sm font-medium truncate" style={{ color: tagColor }}>
                {tagName}
              </div>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              • {itemCount} {itemCount === 1 ? t('aiResults.item_tagged', 'item tagged') : t('aiResults.items_tagged', 'items tagged')}
              {(formCount > 0 || awhCount > 0 || docCount > 0) && (
                <span className="ml-1">
                  ({[
                    formCount > 0 && `${formCount} ${formCount === 1 ? t('aiResults.form', 'Form') : t('aiResults.forms', 'Forms')}`,
                    awhCount > 0 && `${awhCount} AWH`,
                    docCount > 0 && `${docCount} ${docCount === 1 ? t('aiResults.document', 'Document') : t('aiResults.documents', 'Documents')}`
                  ].filter(Boolean).join(', ')})
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-gray-50 text-gray-700 border border-gray-200">
              {t('aiResults.tag', 'tag')}
            </span>
          </div>
        </div>

        <div className="mt-auto pt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              className="text-xs underline text-gray-700 hover:text-gray-900"
              onClick={(e) => {
                e.stopPropagation();
                setShowJson(s => !s);
              }}
            >
              {showJson ? t('aiResults.hide_json') : t('aiResults.view_json')}
            </button>
            <button
              className="text-xs underline text-blue-600 hover:text-blue-800 font-medium"
              onClick={() => panelRef.current?.open(r)}
            >
              {t('aiResults.view_tag', 'View')}
            </button>
          </div>
          {onRequestSwitchToTable && (
            <button
              className="text-xs underline text-primary-700 hover:text-primary-900"
              onClick={(e) => {
                e.stopPropagation();
                onRequestSwitchToTable();
              }}
            >
              {t('aiResults.switch_to_table')}
            </button>
          )}
        </div>

        {showJson && (
          <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {JSON.stringify(r, null, 2)}
          </pre>
        )}
      </div>

      <TagPanelDelegate ref={panelRef} />
    </>
  );
}

