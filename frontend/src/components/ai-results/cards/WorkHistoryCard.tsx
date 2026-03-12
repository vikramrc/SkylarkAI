import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Paperclip, FileText } from 'lucide-react';
import WorkHistoryViewerDelegate, { type WorkHistoryViewerHandle } from '../../work-history/WorkHistoryViewerDelegate';
import GenericCard from './GenericCard';

export default function WorkHistoryCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const awhViewerRef = useRef<WorkHistoryViewerHandle>(null);

  // Check sourceMeta for required IDs - if missing, fallback to GenericCard
  const orgId = resolveOrg(r);
  const awhId = resolveAwhId(r);
  const hasSourceMeta = !!(r?.sourceMeta && orgId && awhId);

  if (!hasSourceMeta) {
    return <GenericCard r={r} displayType="work_history" />;
  }

  const activity = (r?.activity_ID || r?.activityID || r?.activityName || r?.job?.jobTitle) as string | undefined;
  const schedule = (r?.maintenanceSchedule_ID || r?.maintenanceScheduleID || r?.scheduleName || r?.shortName) as string | undefined;
  const vessel = (r?.vessel_ID || r?.vesselID || r?.vesselName) as string | undefined;
  const title = (activity || schedule || vessel || 'Work History') as string;
  const status = (r?.activityCompletionStatus || r?.job?.jobStatus || r?.status) as string | undefined;
  const performedOn = (r?.effectiveCompletedAt || r?.latestPerformedOn || r?.job?.performedOn || r?.performedOn || r?.createdAt || r?.latestCreatedAt) as string | undefined;
  const by = (r?.performedByEmail || r?.performedBy || r?.job?.performedByEmail) as string | undefined;
  const plannedDueDate = (r?.plannedDueDate) as string | undefined;
  const active = r?.active === true;
  const committed = r?.committed === true;

  // Validate IDs for "View AWH" CTA
  const hasCanonicalIds = !!(orgId && /^[a-fA-F0-9]{24}$/.test(String(awhId || '')));

  return (
    <div className="border border-[rgba(202,206,214,0.5)] rounded-xl p-4 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-50 text-blue-700 border border-blue-200 shrink-0"><ClipboardList className="w-3.5 h-3.5" /></span>
            <div className="text-sm font-bold text-gray-900 truncate tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{title}</div>
            {(() => {
              const mach = (r?.machinery_ID || r?.machineryID || r?.machineryName) as string | undefined;
              const comp = (r?.component_ID || r?.componentID || r?.componentName) as string | undefined;
              const label = [mach, comp].filter(Boolean).map(v => String(v)).join(' | ');
              if (!label) return null;
              return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-gray-300 text-gray-700 bg-white shrink-0">
                  {label}
                </span>
              );
            })()}
          </div>
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {vessel && (<span className="text-gray-500">{String(vessel)}</span>)}
            {schedule && (<span className="text-gray-500">{String(schedule)}</span>)}
          </div>
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {plannedDueDate && (<span>{formatDate(plannedDueDate)}</span>)}
            {performedOn && (<span>• {formatDateTime(performedOn)}</span>)}
            {by && (<span>• {String(by)}</span>)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(r?.awh_hasAttachments || r?.awh_hasForms) && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border border-gray-200">
              {r?.awh_hasAttachments && (
                <span title="Has attachments">
                  <Paperclip className="w-4 h-4 text-gray-700" />
                </span>
              )}
              {r?.awh_hasForms && (
                <span title="Has forms">
                  <FileText className="w-4 h-4 text-gray-700" />
                </span>
              )}
            </div>
          )}
          {active && (<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-sky-50 text-sky-700 border border-sky-200">Active</span>)}
          {committed && (<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Committed</span>)}
          {status && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${statusChipClass(status)}`}>{String(status)}</span>
          )}
        </div>
      </div>

      {r?.notes && (
        <div className="mt-2 text-xs text-gray-800 break-words">{String(r.notes)}</div>
      )}

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
            onClick={() => awhViewerRef.current?.open(r)}
            disabled={!hasCanonicalIds}
          >
            {t('aiResults.view_awh', 'View AWH')}
          </button>
        </div>
      </div>

      {showJson && (
        <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {JSON.stringify(r, null, 2)}
        </pre>
      )}
      <WorkHistoryViewerDelegate ref={awhViewerRef} />
    </div>
  );

}

function resolveOrg(r: any): string | undefined {
  return r?.sourceMeta?.organizationID || r?.organizationID || r?.organization_ID || r?.orgID || r?.org_Id || undefined;
}
function resolveAwhId(r: any): string | undefined {
  return (
    r?.sourceMeta?.entities?.activityWorkHistoryId ||
    r?.sourceMeta?.entities?.activityWorkHistory_ID ||
    r?.activityWorkHistory_ID ||
    r?.activityWorkHistoryID ||
    r?.workHistory_ID ||
    r?.workHistoryID ||
    r?._id ||
    undefined
  );
}

function formatDateTime(v?: string) {
  try { const d = v ? new Date(v) : null; if (d && !isNaN(d as any)) return d.toLocaleString(); } catch {}
  return v || '';
}

function formatDate(v?: string) {
  try { const d = v ? new Date(v) : null; if (d && !isNaN(d as any)) return d.toLocaleDateString(); } catch {}
  return v || '';
}

function statusChipClass(s?: string) {
  const k = String(s || '').toLowerCase();
  if (/(completed|done|performed|committed)/.test(k)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (/(missed|failed|rejected)/.test(k)) return 'bg-rose-50 text-rose-700 border-rose-200';
  if (/(created|scheduled|auto[- ]?committed)/.test(k)) return 'bg-gray-50 text-gray-700 border-gray-200';
  if (/(in[- ]?progress|open|pending|started)/.test(k)) return 'bg-sky-50 text-sky-700 border-sky-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}
