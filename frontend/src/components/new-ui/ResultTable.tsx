import React, { useState } from 'react';
import { Database, FileText, Anchor, Ship, Package, Users, FileCheck, Wrench, BarChart2, ChevronRight, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ResultTableProps {
  results: Record<string, any>;
}

// ─── Tool icon / label helpers ───────────────────────────────────────────────

const TOOL_META: Record<string, { icon: React.ReactNode; labelKey: string; color: string }> = {
  maintenance: { icon: <Wrench className="w-3.5 h-3.5" />,   labelKey: 'aiResults.section.work_history',  color: '#f59e0b' },
  budget:      { icon: <BarChart2 className="w-3.5 h-3.5" />, labelKey: 'aiResults.section.other',       color: '#10b981' },
  procurement: { icon: <Package className="w-3.5 h-3.5" />,  labelKey: 'aiResults.section.other',       color: '#6366f1' },
  fleet:       { icon: <Ship className="w-3.5 h-3.5" />,      labelKey: 'aiResults.section.other',       color: '#3b82f6' },
  crew:        { icon: <Users className="w-3.5 h-3.5" />,     labelKey: 'aiResults.section.other',       color: '#ec4899' },
  inventory:   { icon: <Database className="w-3.5 h-3.5" />,  labelKey: 'aiResults.section.inventory_usage', color: '#8b5cf6' },
  documents:   { icon: <FileCheck className="w-3.5 h-3.5" />, labelKey: 'aiResults.section.documents',    color: '#0ea5e9' },
  analytics:   { icon: <BarChart2 className="w-3.5 h-3.5" />, labelKey: 'aiResults.section.other',       color: '#f43f5e' },
  voyage:      { icon: <Anchor className="w-3.5 h-3.5" />,    labelKey: 'aiResults.section.other',       color: '#14b8a6' },
};

function getToolMeta(name: string) {
  const domain = name.split('.')[0] ?? name;
  return TOOL_META[domain] ?? { icon: <FileText className="w-3.5 h-3.5" />, labelKey: name, color: '#6b7280' };
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ─── Payload extraction ───────────────────────────────────────────────────────

function extractItems(rawPayload: any): any[] {
  let source = rawPayload;

  // Step A: Unwrap direct_query_fallback: { success, data }
  if (source && source.success !== undefined && source.data !== undefined) {
    source = source.data;
  }

  // Step B: Unwrap MCP content envelope: { content: [{ type: 'text', text: '...' }] }
  if (source && Array.isArray(source.content) && source.content.length > 0 && source.content[0]?.type === 'text') {
    try { source = JSON.parse(source.content[0].text); } catch (_) {}
  }

  // Step C: Drill into PhoenixCloud API shapes
  const drill = (obj: any): any[] => {
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object') return [];
    const candidate = obj.data || obj.results || obj.items || obj.records || obj.list;
    if (Array.isArray(candidate)) return candidate;
    const keys = Object.keys(obj).filter(k => !['success','status','message','count','total','capability','organizationID','appliedFilters','summary'].includes(k));
    if (keys.length > 0 && typeof obj[keys[0]] !== 'object') return [obj];
    return [];
  };

  return drill(source);
}

// ─── Cell renderer ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  overdue:    'bg-red-100 text-red-700 border-red-200',
  upcoming:   'bg-amber-100 text-amber-700 border-amber-200',
  completed:  'bg-green-100 text-green-700 border-green-200',
  pending:    'bg-blue-100 text-blue-700 border-blue-200',
  active:     'bg-emerald-100 text-emerald-700 border-emerald-200',
  inactive:   'bg-gray-100 text-gray-600 border-gray-200',
  high:       'bg-red-100 text-red-700 border-red-200',
  medium:     'bg-amber-100 text-amber-700 border-amber-200',
  low:        'bg-blue-100 text-blue-700 border-blue-200',
  critical:   'bg-red-200 text-red-800 border-red-300',
};

function RenderCell({ colKey, value, row }: { colKey: string; value: any; row?: any }) {
  const { t } = useTranslation();
  if (value === null || value === undefined) return <span className="text-gray-300">—</span>;

  const kLower = colKey.toLowerCase();
  const vStr = String(value);

  // Badge
  if (kLower.includes('status') || kLower.includes('priority') || kLower.includes('category') || kLower.includes('level') || kLower.includes('type')) {
    const colorClass = STATUS_COLORS[vStr.toLowerCase()] ?? 'bg-gray-100 text-gray-700 border-gray-200';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
        {vStr}
      </span>
    );
  }

  // Currency
  if ((kLower.includes('price') || kLower.includes('cost') || kLower.includes('budget') || kLower.includes('value') || kLower.includes('amount')) && !isNaN(Number(value))) {
    // Try to find currency in row
    const currency = row?.currency || row?.CURRENCY || row?.currencyCode;
    const currencyStr = currency ? String(currency) : '';
    
    // Simple symbol mapping or just use the code
    const symbolMap: Record<string, string> = { 'USD': '$', 'JPY': '¥', 'EUR': '€', 'GBP': '£' };
    const prefix = symbolMap[currencyStr.toUpperCase()] || (currencyStr ? `${currencyStr} ` : '');

    return (
      <span className="font-mono text-emerald-700">
        {prefix}{Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }

  // Boolean
  if (typeof value === 'boolean') {
    return value
      ? <span className="text-green-600 font-medium text-xs">{t('bool.yes')}</span>
      : <span className="text-gray-400 text-xs">{t('bool.no')}</span>;
  }

  return <span className="text-gray-900">{vStr}</span>;
}

// ─── Fleet overview specific layout ────────────────────────────────────────────

function FleetOverviewCards({ items }: { items: any[] }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Ship className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">{t('result.no_fleet_data')}</p>
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((vessel, idx) => {
          const stats = vessel.awhStats || {};
          return (
            <div key={idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col hover:border-gray-300 transition-all shadow-none">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-transparent">
                <div className="flex items-center gap-2 min-w-0">
                  <Ship className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="text-[13px] font-semibold text-gray-900 truncate">
                    {vessel.vesselName || vessel.VESSEL_NAME || t('result.unknown_vessel')}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 font-mono shrink-0 ml-2">{vessel.vesselImoNumber || vessel.VESSEL_IMO_NUMBER || '--'}</span>
              </div>
              <div className="p-3 grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 tracking-tight mb-1">
                    <AlertCircle className="w-3 h-3 text-red-500" /> Overdue
                  </span>
                  <span className="text-base font-semibold text-red-600 leading-none">{stats.overdue || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 tracking-tight mb-1">
                    <Clock className="w-3 h-3 text-amber-500" /> Upcoming
                  </span>
                  <span className="text-base font-semibold text-amber-600 leading-none">{stats.upcoming7d || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 tracking-tight mb-1">
                    <CheckCircle className="w-3 h-3 text-emerald-500" /> Completed
                  </span>
                  <span className="text-base font-semibold text-emerald-600 leading-none">{stats.completedInRange || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 tracking-tight mb-1">
                    <Clock className="w-3 h-3 text-purple-500" /> Missed
                  </span>
                  <span className="text-base font-semibold text-purple-600 leading-none">{stats.missedInRange || 0}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Single tool table ─────────────────────────────────────────────────────────

function ToolTable({ toolName, rawPayload }: { toolName: string; rawPayload: any }) {
  const { t } = useTranslation();
  const items = extractItems(rawPayload);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <FileText className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">{t('result.no_tool_data')}</p>
      </div>
    );
  }

  const firstItem = items[0];
  const columns = Object.keys(firstItem).filter(key =>
    key !== '_id' && key !== '__v' && typeof firstItem[key] !== 'object'
  );

  const formatHeader = (key: string) => {
    // Handle specific common acronyms first so they don't get split up
    let formatted = key.replace(/ID/g, 'Id');
    // Split on camelCase
    formatted = formatted.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Capitalize each word (Title Case)
    return formatted.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()).trim();
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100 text-[15px] leading-relaxed">
        <thead>
          <tr className="border-b border-gray-200 bg-white">
            <th className="w-6 px-4 py-4"></th>
            {columns.map((col, idx) => (
              <th
                key={idx}
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold text-gray-500"
              >
                {formatHeader(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {items.map((row, rowIdx) => {
            const isExpanded = expandedRow === rowIdx;
            const hasAnswers = row.answers && Array.isArray(row.answers) && row.answers.length > 0;
            const hasTemplateAttachments = row.templateAttachments && Array.isArray(row.templateAttachments) && row.templateAttachments.length > 0;
            
            return (
              <React.Fragment key={rowIdx}>
                <tr 
                  onClick={() => setExpandedRow(isExpanded ? null : rowIdx)} 
                  className="hover:bg-blue-50/30 transition-colors duration-100 cursor-pointer"
                >
                  <td className="px-4 py-4 whitespace-nowrap align-middle">
                    <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-120 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`} />
                  </td>
                  {columns.map((col, colIdx) => (
                    <td key={colIdx} className="px-4 py-4 whitespace-nowrap align-middle">
                      <RenderCell colKey={col} value={row[col]} row={row} />
                    </td>
                  ))}
                </tr>
                
                {isExpanded && (
                  <tr className="bg-gray-50/30">
                    <td colSpan={columns.length + 1} className="px-6 py-4">
                      <div className="space-y-4">
                        {/* Special Renderer for 'answers' */}
                        {hasAnswers && (
                          <div className="border border-gray-100 rounded-lg bg-white p-3 shadow-sm">
                            <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5 text-blue-500" />
                              {t('result.form_contents')}
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                              {row.answers.map((ans: any, idx: number) => {
                                const hasAttachments = ans.attachedFiles && ans.attachedFiles.length > 0;
                                const hasDms = ans.dmsDocs && ans.dmsDocs.length > 0;
                                
                                return (
                                  <div key={idx} className="flex flex-col border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                                    <span className="text-[11px] font-medium text-gray-400">
                                      {ans.sectionTitle ? `[${ans.sectionTitle}] ` : ''}{ans.label}
                                    </span>
                                    <span className="text-sm text-gray-700 font-medium">
                                      {ans.value !== null && ans.value !== undefined ? String(ans.value) : <span className="text-gray-300 italic">{t('result.unfilled')}</span>}
                                    </span>
                                    {hasAttachments && (
                                      <div className="flex items-center gap-1 mt-0.5 text-xs text-blue-600">
                                        <Anchor className="w-3 h-3" />
                                        <span>Attachments: {ans.attachedFiles.map((f: any) => f.filename || 'unknown').join(', ')}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Special Renderer for 'templateAttachments' */}
                        {hasTemplateAttachments && (
                          <div className="border border-gray-100 rounded-lg bg-white p-3 shadow-sm">
                            <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5 text-emerald-500" />
                              {t('result.template_files')}
                            </h4>
                            <div className="flex flex-col gap-1.5">
                              {row.templateAttachments.map((f: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                                  <span className="font-medium">{f.filename}</span>
                                  {f.contentType && <span className="text-xs text-gray-400">({f.contentType})</span>}
                                  {f.description && <span className="text-xs text-gray-400 border-l border-gray-200 pl-1.5">{f.description}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Catch-all JSON dump for rest of objects */}
                        {Object.keys(row)
                          .filter(key => typeof row[key] === 'object' && row[key] !== null && !['answers', 'templateAttachments'].includes(key))
                          .map((key, idx) => (
                            <div key={idx} className="border border-gray-100 rounded-lg bg-white p-3 shadow-sm">
                              <h4 className="text-xs font-semibold text-gray-600 mb-1">{formatHeader(key)}</h4>
                              <pre className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded overflow-x-auto">
                                {JSON.stringify(row[key], null, 2)}
                              </pre>
                            </div>
                          ))
                        }
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const ResultTable: React.FC<ResultTableProps> = ({ results }) => {
  const { t } = useTranslation();
  // Keep an entry if it has rows OR if the LLM explicitly labeled it (uiTabLabel present).
  // A labeled-but-empty entry means the LLM intentionally queried something that returned 0 rows —
  // we still show the tab so the user sees "No data found" for that window (e.g. "This Year: 0 rows").
  // Unlabeled empty entries (internal tools like mcp.clear_filters) are still suppressed.
  const rawEntries = Object.entries(results).filter(([, payload]) =>
    extractItems(payload).length > 0 || !!payload?.uiTabLabel
  );
  
  // Deduplicate entries based on stringified items to prevent overlapping tabs 
  // when the orchestrator calls the same tool repeatedly across multiple iterations
  const uniqueEntriesMap = new Map<string, [string, any]>();
  rawEntries.forEach(([key, payload]) => {
    const items = extractItems(payload);
    const dataHash = JSON.stringify(items);
    if (!uniqueEntriesMap.has(dataHash)) {
      uniqueEntriesMap.set(dataHash, [key, payload]);
    }
  });
  
  const toolEntries = Array.from(uniqueEntriesMap.values());

  const [activeTab, setActiveTab] = useState(0);

  if (toolEntries.length === 0) return null;

  // Single tool — no tabs needed, just render the table directly
  if (toolEntries.length === 1) {
    const [toolName, payload] = toolEntries[0]!;
    const items = extractItems(payload);
    const isFleetOverview = toolName.includes('fleet.query_overview');
    return (
      <div className="w-full">
        {isFleetOverview ? <FleetOverviewCards items={items} /> : <ToolTable toolName={toolName} rawPayload={payload} />}
      </div>
    );
  }

  // Multi-tool — tabbed panel
  const [activeName, activePayload] = toolEntries[activeTab] ?? toolEntries[0]!;
  const activeMeta = getToolMeta(activeName);
  const activeItems = extractItems(activePayload);

  return (
    <div className="w-full flex flex-col gap-2">
      {/* Tab bar */}
      <div className="flex items-stretch overflow-x-auto">
        {toolEntries.map(([toolName, payload], idx) => {
          const meta = getToolMeta(toolName);
          const isActive = idx === activeTab;
          const displayLabel = payload.uiTabLabel || humanizeToolName(toolName);

          return (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-150 outline-none
                ${isActive
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 bg-transparent'}
              `}
            >
              <span style={{ color: isActive ? meta.color : undefined }}>{meta.icon}</span>
              <span>{displayLabel}</span>
            </button>
          );
        })}

        {/* right-side label */}
        <div className="ml-auto flex items-center pr-3 text-xs text-gray-400 gap-1.5 shrink-0">
          <span className="hidden sm:inline">{t('result.sources_count', { count: toolEntries.length })}</span>
        </div>
      </div>

      {/* Active tab content */}
      <div className="relative mt-2">
        {activeName.includes('fleet.query_overview') ? <FleetOverviewCards items={activeItems} /> : <ToolTable toolName={activeName} rawPayload={activePayload} />}
      </div>
    </div>
  );
};

export default ResultTable;
