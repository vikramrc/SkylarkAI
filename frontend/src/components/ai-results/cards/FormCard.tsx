import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import FormViewerDelegate, { type FormViewerHandle } from '../../forms/FormViewerDelegate';
import GenericCard from './GenericCard';

export default function FormCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const viewerRef = useRef<FormViewerHandle>(null);

  // Check sourceMeta for required IDs - if missing, fallback to GenericCard
  const orgId = r?.sourceMeta?.organizationID;
  const formId = r?.sourceMeta?.entities?.formId || r?._id;
  const hasSourceMeta = !!(r?.sourceMeta && orgId && formId);

  if (!hasSourceMeta) {
    return <GenericCard r={r} displayType="form" />;
  }

  const title = (r?.form?.name || r?.name || r?.formName || r?.formTitle || r?.Form_ID || 'Form') as string;
  const description = (r?.form?.description || r?.description || r?.formDescription) as string | undefined;
  const status = (r?.status || (r?.validated === true ? 'validated' : undefined) || (r?.rejected === true ? 'rejected' : undefined)) as string | undefined;
  const submittedAt = (r?.submittedAt || r?.createdAt) as string | undefined;
  const committedAt = (r?.committedAt) as string | undefined;
  const vessel = (r?.vessel_ID || r?.vesselID || r?.vesselName) as string | undefined;
  const template = (r?.formTemplateName || r?.templateName || r?.FormTemplate_ID) as string | undefined;

  return (
    <div className="border border-[rgba(202,206,214,0.5)] rounded-xl p-4 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0"><FileText className="w-3.5 h-3.5" /></span>
            <div className="text-sm font-bold text-gray-900 truncate tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{title}</div>
          </div>
          {description && (
            <div className="text-xs text-gray-600 mt-1">{description}</div>
          )}
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {vessel && (<span className="text-gray-500">{String(vessel)}</span>)}
            {template && (<span className="text-gray-500">{String(template)}</span>)}
          </div>
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {submittedAt && (<span><span className="text-gray-500">{t('aiResults.submitted_at', 'Submitted at')}:</span> {formatDateTime(submittedAt)}</span>)}
            {committedAt && (<span>• <span className="text-gray-500">{t('aiResults.committed_at', 'Committed at')}:</span> {formatDateTime(committedAt)}</span>)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 capitalize">{String(status)}</span>
          )}
        </div>
      </div>

      <div className="mt-auto pt-2 flex items-center justify-between">
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
            onClick={() => viewerRef.current?.open(r?.form)}
            disabled={!r?.form}
          >
            {t('aiResults.view_form', 'View form')}
          </button>
        </div>
      </div>

      {showJson && (
        <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {JSON.stringify(r, null, 2)}
        </pre>
      )}

      <FormViewerDelegate ref={viewerRef} />
    </div>
  );
}

function formatDateTime(v?: string) {
  try { const d = v ? new Date(v) : null; if (d && !isNaN(d as any)) return d.toLocaleString(); } catch {}
  return v || '';
}

