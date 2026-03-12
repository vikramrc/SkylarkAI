import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import ReplenishOrderViewerDelegate, { type ReplenishOrderViewerHandle } from '../../orders/ReplenishOrderViewerDelegate';
import GenericCard from './GenericCard';

function isLikelyObjectId(v: any): boolean { return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v); }

export default function ReplenishOrderCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const viewerRef = useRef<ReplenishOrderViewerHandle>(null);

  const orgId = r?.sourceMeta?.organizationID;
  const rid = r?.sourceMeta?.entities?.replenishOrderId;

  // Check sourceMeta for required IDs - if missing, fallback to GenericCard
  const hasSourceMeta = !!(r?.sourceMeta && orgId && rid);

  if (!hasSourceMeta) {
    return <GenericCard r={r} displayType="replenish_order" />;
  }

  const title = (r?.orderNumber || r?.title || t('aiResults.replenish_order', 'Replenish Order')) as string;

  // Validate IDs for "View RO" CTA
  const hasCanonicalIds = !!(isLikelyObjectId(rid) && isLikelyObjectId(orgId));

  return (
    <>
      <div className="border border-[rgba(202,206,214,0.5)] rounded-lg p-3 bg-white hover:shadow-sm transition">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate" title={title}>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 text-gray-700 border border-gray-200"><Package className="w-3.5 h-3.5" /></span>
              <div className="text-sm font-medium text-gray-900">{title}</div>
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="text-xs underline text-gray-700 hover:text-gray-900" onClick={() => setShowJson(s => !s)}>
              {showJson ? t('aiResults.hide_json', 'Hide JSON') : t('aiResults.view_json', 'View JSON')}
            </button>
            <button
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              onClick={() => viewerRef.current?.open(r)}
              disabled={!hasCanonicalIds}
              title={!hasCanonicalIds ? 'Missing organization or replenish order ID' : ''}
            >
              {t('aiResults.view_replenish_order', 'View Replenish Order')}
            </button>
          </div>
          {onRequestSwitchToTable && (
            <button className="text-xs underline text-primary-700 hover:text-primary-900" onClick={onRequestSwitchToTable}>
              {t('aiResults.switch_to_table', 'Switch to table view')}
            </button>
          )}
        </div>
        {showJson && (
          <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {JSON.stringify(r, null, 2)}
          </pre>
        )}
      </div>
      <ReplenishOrderViewerDelegate ref={viewerRef} />
    </>
  );
}

