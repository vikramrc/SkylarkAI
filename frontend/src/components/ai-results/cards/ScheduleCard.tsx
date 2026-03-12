import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';

export default function ScheduleCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);

  const title = (r?.shortName || r?.name || r?.maintenanceSchedule_ID || 'Maintenance Schedule') as string;
  const active = r?.active === true;
  const vessel = (r?.vesselName || r?.vessel_ID || r?.vesselID) as string | undefined;
  const period = toRange(r?.minScheduleYear, r?.maxScheduleYear);

  return (
    <div className="border border-[rgba(202,206,214,0.5)] rounded-lg p-3 bg-white hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate" title={title}>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-teal-50 text-teal-700 border border-teal-200"><Calendar className="w-3.5 h-3.5" /></span>
            <div className="text-sm font-medium text-gray-900">{title}</div>
          </div>
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {vessel && (<span className="text-gray-500">{String(vessel)}</span>)}
            {period && (<span>{period}</span>)}
          </div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border ${active ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
          {active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className="text-xs underline text-gray-700 hover:text-gray-900" onClick={() => setShowJson(s => !s)}>
          {showJson ? t('aiResults.hide_json') : t('aiResults.view_json')}
        </button>
        {onRequestSwitchToTable && (
          <button className="text-xs underline text-primary-700 hover:text-primary-900" onClick={onRequestSwitchToTable}>
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
  );
}

function toRange(a?: any, b?: any) {
  const an = Number(a); const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return `${an}-${bn}`;
  if (Number.isFinite(an)) return `${an}`;
  if (Number.isFinite(bn)) return `${bn}`;
  return '';
}

