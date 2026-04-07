import React, { useState } from 'react';
import { Database, FileText, Anchor, Ship, Package, Users, FileCheck, Wrench, BarChart2, ChevronRight, AlertCircle, Clock, CheckCircle } from 'lucide-react';

interface ResultTableProps {
  results: Record<string, any>;
}

// ─── Tool icon / label helpers ───────────────────────────────────────────────

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  maintenance: { icon: <Wrench className="w-3.5 h-3.5" />,   label: 'Maintenance',  color: '#f59e0b' },
  budget:      { icon: <BarChart2 className="w-3.5 h-3.5" />, label: 'Budget',       color: '#10b981' },
  procurement: { icon: <Package className="w-3.5 h-3.5" />,  label: 'Procurement',  color: '#6366f1' },
  fleet:       { icon: <Ship className="w-3.5 h-3.5" />,      label: 'Fleet',        color: '#3b82f6' },
  crew:        { icon: <Users className="w-3.5 h-3.5" />,     label: 'Crew',         color: '#ec4899' },
  inventory:   { icon: <Database className="w-3.5 h-3.5" />,  label: 'Inventory',    color: '#8b5cf6' },
  documents:   { icon: <FileCheck className="w-3.5 h-3.5" />, label: 'Documents',    color: '#0ea5e9' },
  analytics:   { icon: <BarChart2 className="w-3.5 h-3.5" />, label: 'Analytics',    color: '#f43f5e' },
  voyage:      { icon: <Anchor className="w-3.5 h-3.5" />,    label: 'Voyage',       color: '#14b8a6' },
};

function getToolMeta(name: string) {
  const domain = name.split('.')[0] ?? name;
  return TOOL_META[domain] ?? { icon: <FileText className="w-3.5 h-3.5" />, label: name, color: '#6b7280' };
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

function renderCell(key: string, value: any, row?: any): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-gray-300">—</span>;

  const kLower = key.toLowerCase();
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
      ? <span className="text-green-600 font-medium text-xs">Yes</span>
      : <span className="text-gray-400 text-xs">No</span>;
  }

  return <span className="text-gray-700">{vStr}</span>;
}

// ─── Fleet overview specific layout ────────────────────────────────────────────

function FleetOverviewCards({ items }: { items: any[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Ship className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No fleet data returned.</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-50/40">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {items.map((vessel, idx) => {
          const stats = vessel.awhStats || {};
          return (
            <div key={idx} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:border-gray-200 hover:shadow-md transition-all">
              <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between bg-blue-50/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Ship className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs font-bold text-gray-800 truncate">{vessel.vesselName || vessel.VESSEL_NAME || 'Unknown Vessel'}</span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono shrink-0 ml-2">{vessel.vesselImoNumber || vessel.VESSEL_IMO_NUMBER || '--'}</span>
              </div>
              <div className="p-2 grid grid-cols-2 gap-1.5">
                <div className="flex flex-col bg-red-50/80 rounded p-1.5 border border-red-50">
                  <span className="flex items-center gap-1 text-[9px] uppercase font-bold text-red-600 tracking-wide mb-0.5">
                    <AlertCircle className="w-2.5 h-2.5" /> Overdue
                  </span>
                  <span className="text-sm font-bold text-red-700 leading-none">{stats.overdue || 0}</span>
                </div>
                <div className="flex flex-col bg-amber-50/80 rounded p-1.5 border border-amber-50">
                  <span className="flex items-center gap-1 text-[9px] uppercase font-bold text-amber-600 tracking-wide mb-0.5">
                    <Clock className="w-2.5 h-2.5" /> Upcoming
                  </span>
                  <span className="text-sm font-bold text-amber-700 leading-none">{stats.upcoming7d || 0}</span>
                </div>
                <div className="flex flex-col bg-emerald-50/80 rounded p-1.5 border border-emerald-50">
                  <span className="flex items-center gap-1 text-[9px] uppercase font-bold text-emerald-600 tracking-wide mb-0.5">
                    <CheckCircle className="w-2.5 h-2.5" /> Completed
                  </span>
                  <span className="text-sm font-bold text-emerald-700 leading-none">{stats.completedInRange || 0}</span>
                </div>
                <div className="flex flex-col bg-gray-50/80 rounded p-1.5 border border-gray-100">
                  <span className="flex items-center gap-1 text-[9px] uppercase font-bold text-gray-500 tracking-wide mb-0.5">
                    <Wrench className="w-2.5 h-2.5" /> Rescheduled
                  </span>
                  <span className="text-sm font-bold text-gray-700 leading-none">{stats.rescheduledInRange || 0}</span>
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
  const items = extractItems(rawPayload);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <FileText className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No data returned for this tool</p>
      </div>
    );
  }

  const firstItem = items[0];
  const columns = Object.keys(firstItem).filter(key =>
    key !== '_id' && key !== '__v' && typeof firstItem[key] !== 'object'
  );

  const formatHeader = (key: string) =>
    key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead>
          <tr className="bg-gray-50/60">
            <th className="w-6 px-4 py-2.5"></th>
            {columns.map((col, idx) => (
              <th
                key={idx}
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 tracking-wide uppercase"
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
                  <td className="px-4 py-2.5 whitespace-nowrap align-middle">
                    <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-120 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`} />
                  </td>
                  {columns.map((col, colIdx) => (
                    <td key={colIdx} className="px-4 py-2.5 whitespace-nowrap align-middle">
                      {renderCell(col, row[col], row)}
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
                              Form Contents
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
                                      {ans.value !== null && ans.value !== undefined ? String(ans.value) : <span className="text-gray-300 italic">Unfilled</span>}
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
                              Template Static Files
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
  const toolEntries = Object.entries(results).filter(([, payload]) => extractItems(payload).length > 0);

  const [activeTab, setActiveTab] = useState(0);

  if (toolEntries.length === 0) return null;

  // Single tool — no tabs needed, just render the table directly
  if (toolEntries.length === 1) {
    const [toolName, payload] = toolEntries[0]!;
    const meta = getToolMeta(toolName);
    const items = extractItems(payload);
    const isFleetOverview = toolName.includes('fleet.query_overview');
    return (
      <div className="w-full rounded-xl border border-gray-100 shadow-sm overflow-hidden bg-white">
        {/* Count pill */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
            {meta.icon}
            <span style={{ color: meta.color }} className="font-semibold">{payload.uiTabLabel || humanizeToolName(toolName)}</span>
          </span>
          <span className="ml-auto text-xs text-gray-400">{items.length} {items.length === 1 ? 'record' : 'records'}</span>
        </div>
        {isFleetOverview ? <FleetOverviewCards items={items} /> : <ToolTable toolName={toolName} rawPayload={payload} />}
      </div>
    );
  }

  // Multi-tool — tabbed panel
  const [activeName, activePayload] = toolEntries[activeTab] ?? toolEntries[0]!;
  const activeMeta = getToolMeta(activeName);
  const activeItems = extractItems(activePayload);

  return (
    <div className="w-full rounded-xl border border-gray-100 shadow-sm overflow-hidden bg-white">
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-gray-100 bg-gray-50/50 overflow-x-auto">
        {toolEntries.map(([toolName, payload], idx) => {
          const meta = getToolMeta(toolName);
          const isActive = idx === activeTab;
          const count = extractItems(payload).length;
          const displayLabel = payload.uiTabLabel || humanizeToolName(toolName);

          return (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              className={`
                flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all duration-150 outline-none
                ${isActive
                  ? 'border-blue-500 text-blue-600 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'}
              `}
            >
              <span style={{ color: isActive ? meta.color : undefined }}>{meta.icon}</span>
              <span>{displayLabel}</span>
              <span className={`
                ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                ${isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}
              `}>
                {count}
              </span>
              {isActive && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
            </button>
          );
        })}

        {/* right-side label */}
        <div className="ml-auto flex items-center pr-3 text-xs text-gray-400 gap-1.5 shrink-0">
          <span className="hidden sm:inline">{toolEntries.length} sources</span>
        </div>
      </div>

      {/* Active tab content */}
      <div className="relative">
        {/* Active tab metadata bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-50 bg-white">
          <span style={{ color: activeMeta.color }} className="font-medium text-xs">{activePayload.uiTabLabel || humanizeToolName(activeName)}</span>
          <span className="text-gray-300 text-xs">·</span>
          <span className="text-xs text-gray-400">{activeItems.length} {activeItems.length === 1 ? 'record' : 'records'}</span>
        </div>

        {activeName.includes('fleet.query_overview') ? <FleetOverviewCards items={activeItems} /> : <ToolTable toolName={activeName} rawPayload={activePayload} />}
      </div>
    </div>
  );
};

export default ResultTable;
