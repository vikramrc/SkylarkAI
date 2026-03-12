import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import DocumentViewerDelegate, { type DocumentViewerHandle } from '../../documents/DocumentViewerDelegate';
import GenericCard from './GenericCard';

export default function DocumentCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const docViewerRef = useRef<DocumentViewerHandle>(null);

  // ID resolution for "View Document" button
  function isLikelyObjectId(v: any): boolean {
    return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
  }

  const orgId = r?.sourceMeta?.organizationID || r?.organizationID || r?.organization_ID;
  const docId = r?.sourceMeta?.entities?.documentMetadataId || r?._id;

  // Check sourceMeta for required IDs - if missing, fallback to GenericCard
  const hasSourceMeta = !!(r?.sourceMeta && orgId && docId);

  if (!hasSourceMeta) {
    return <GenericCard r={r} displayType="document" />;
  }

  const name = (r?.originalFileName || r?.originalName || r?.fileName || r?.name || r?.documentName || 'Document') as string;
  const contentType = (r?.contentType || r?.mimeType) as string | undefined;
  const size = toSizeString(r?.size);

  // Validate IDs for "View Document" CTA
  const hasCanonicalIds = !!(orgId && isLikelyObjectId(docId));

  return (
    <>
    <div className="border border-[rgba(202,206,214,0.5)] rounded-xl p-4 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate" title={name}>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 text-gray-700 border border-gray-200"><FileText className="w-3.5 h-3.5" /></span>
            <div className="text-sm font-bold text-gray-900 tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{name}</div>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {contentType && (<span className="mr-2">{contentType}</span>)}
            {size && (<span className="text-gray-500">{size}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className="text-xs underline text-gray-700 hover:text-gray-900" onClick={() => setShowJson(s => !s)}>
          {showJson ? t('aiResults.hide_json') : t('aiResults.view_json')}
        </button>
        <div className="flex items-center gap-3">
          {onRequestSwitchToTable && (
            <button className="text-xs underline text-primary-700 hover:text-primary-900" onClick={onRequestSwitchToTable}>
              {t('aiResults.switch_to_table')}
            </button>
          )}
          <button
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-blue-500/20 transition-all"
            onClick={() => docViewerRef.current?.open(r)}
            disabled={!hasCanonicalIds}
            title={!hasCanonicalIds ? 'Missing organization or document ID' : ''}
          >
            {t('aiResults.view_document', 'View Document')}
          </button>
        </div>
      </div>
      {showJson && (
        <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {JSON.stringify(r, null, 2)}
        </pre>
      )}
    </div>
    <DocumentViewerDelegate ref={docViewerRef} />
    </>
  );
}

function toSizeString(bytes?: any) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024; return `${gb.toFixed(1)} GB`;
}

