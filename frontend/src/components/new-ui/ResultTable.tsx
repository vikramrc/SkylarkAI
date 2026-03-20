import React, { useState } from 'react';
import { Database, FileText, Anchor, Ship, Package, Users, FileCheck, Wrench, BarChart2, ChevronRight } from 'lucide-react';

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

function renderCell(key: string, value: any): React.ReactNode {
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
    return <span className="font-mono text-emerald-700">${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
  }

  // Boolean
  if (typeof value === 'boolean') {
    return value
      ? <span className="text-green-600 font-medium text-xs">Yes</span>
      : <span className="text-gray-400 text-xs">No</span>;
  }

  return <span className="text-gray-700">{vStr}</span>;
}

// ─── Single tool table ─────────────────────────────────────────────────────────

function ToolTable({ toolName, rawPayload }: { toolName: string; rawPayload: any }) {
  const items = extractItems(rawPayload);

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
          {items.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-blue-50/30 transition-colors duration-100">
              {columns.map((col, colIdx) => (
                <td key={colIdx} className="px-4 py-2.5 whitespace-nowrap align-middle">
                  {renderCell(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
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
    return (
      <div className="w-full rounded-xl border border-gray-100 shadow-sm overflow-hidden bg-white">
        {/* Count pill */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
            {meta.icon}
            <span style={{ color: meta.color }} className="font-semibold">{humanizeToolName(toolName)}</span>
          </span>
          <span className="ml-auto text-xs text-gray-400">{items.length} {items.length === 1 ? 'record' : 'records'}</span>
        </div>
        <ToolTable toolName={toolName} rawPayload={payload} />
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
              <span>{humanizeToolName(toolName)}</span>
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
          <span style={{ color: activeMeta.color }} className="font-medium text-xs">{humanizeToolName(activeName)}</span>
          <span className="text-gray-300 text-xs">·</span>
          <span className="text-xs text-gray-400">{activeItems.length} {activeItems.length === 1 ? 'record' : 'records'}</span>
        </div>

        <ToolTable toolName={activeName} rawPayload={activePayload} />
      </div>
    </div>
  );
};

export default ResultTable;
