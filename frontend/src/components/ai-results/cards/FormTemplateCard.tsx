import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck } from 'lucide-react';
import FormTemplateViewerDelegate, { type FormTemplateViewerHandle } from '../../forms/FormTemplateViewerDelegate';

export default function FormTemplateCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const viewerRef = useRef<FormTemplateViewerHandle>(null);

  const name = (r?.formTemplateName || r?.name || 'Form Template') as string;
  const description = (r?.description || r?.formTemplateDescription) as string | undefined;
  const optional = r?.isOptional === true || r?.optional === true;

  // Check sourceMeta for required IDs - organizationID is optional, will be fetched from backend if missing
  const formTemplateId = r?.sourceMeta?.entities?.formTemplateId;
  const hasSourceMeta = !!formTemplateId;

  return (
    <>
      <div className="border rounded-lg p-3 bg-white hover:shadow-sm transition">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate" title={name}>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-green-50 text-green-700 border border-green-200"><ClipboardCheck className="w-3.5 h-3.5" /></span>
              <div className="text-sm font-medium text-gray-900">{name}</div>
            </div>
            {description && (<div className="text-xs text-gray-600 mt-1 break-words">{description}</div>)}
          </div>
          {optional && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Optional</span>
          )}
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
              className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => viewerRef.current?.open(r)}
              disabled={!hasSourceMeta}
              title={!hasSourceMeta ? 'Missing formTemplateId in sourceMeta' : 'View template'}
            >
              {t('aiResults.view_template', 'View')}
            </button>
          </div>
        </div>
        {showJson && (
          <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {JSON.stringify(r, null, 2)}
          </pre>
        )}
      </div>
      <FormTemplateViewerDelegate ref={viewerRef} />
    </>
  );
}

