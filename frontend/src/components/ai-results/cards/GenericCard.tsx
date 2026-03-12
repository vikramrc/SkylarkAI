import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Copy, User, Calendar, FileText, Box, Tag, Layers, CheckCircle, AlertCircle, Clock, XCircle, Hash, AlignLeft } from 'lucide-react';

// --- Helper Components ---

// Status Badge Component
const StatusBadge = ({ value, type }: { value: string; type?: 'status' | 'type' | 'state' }) => {
  const v = String(value).toLowerCase();
  
  let colorClass = 'bg-gray-100 text-gray-700 border-gray-200 ring-gray-500/20';
  
  if (v === 'completed' || v === 'active' || v === 'approved' || v === 'verified' || v === 'permanent' || v === 'watch') {
    colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/20';
  } else if (v === 'in-progress' || v === 'pending' || v === 'draft' || v === 'submitted' || v === 'requested') {
    colorClass = 'bg-blue-50 text-blue-700 border-blue-200 ring-blue-500/20';
  } else if (v === 'cancelled' || v === 'rejected' || v === 'missed' || v === 'off-hire') {
    colorClass = 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-500/20';
  } else if (v === 'suspended' || v === 'on-hold' || v === 'daywork' || v === 'overdue') {
    colorClass = 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/20';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ring-1 ring-inset ${colorClass} capitalize shadow-sm`}>
      {value}
    </span>
  );
};

// Smart Copy Component
const SmartCopy = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button 
      onClick={handleCopy}
      className="ml-1.5 p-1 text-gray-400 hover:text-primary-600 transition-all rounded hover:bg-gray-100"
      title="Copy Value"
    >
      {copied ? <CheckCircle className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
    </button>
  );
};

// Icon Helper
const getIconForType = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes('crew') || t.includes('user')) return <User className="w-4 h-4" />;
  if (t.includes('shift') || t.includes('schedule')) return <Calendar className="w-4 h-4" />;
  if (t.includes('form') || t.includes('document')) return <FileText className="w-4 h-4" />;
  if (t.includes('inventory') || t.includes('part') || t.includes('stock')) return <Box className="w-4 h-4" />;
  if (t.includes('tag')) return <Tag className="w-4 h-4" />;
  return <Layers className="w-4 h-4" />;
};

export default function GenericCard({ r, displayType }: { r: any; displayType?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);

  // 1. Process Data
  const allEntries = Object.entries(r || {}).filter(([k]) => !String(k).startsWith('_') && k !== 'sourceMeta');

  const title = (
    r?.title || r?.name || r?.activityName || r?.vesselName || r?.formTemplateName ||
    r?.documentName || r?.originalName || r?.fileName || 'Item'
  ) as string;

  // Identify Header Preview Fields:
  // - Simple values (String, Number, Boolean)
  // - Exclude Title
  // - Exclude raw ObjectIDs (24-char hex)
  const previewFields = allEntries.filter(([k, v]) => {
    // Must be simple
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return false;
    
    // Exclude title-like fields if they match the main title
    if (v === title) return false;

    // Exclude raw ObjectIDs
    if (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v)) return false;

    return true;
  }).slice(0, 3); // Take top 3

  // String Data: All simple fields (including IDs)
  const stringData = allEntries.filter(([_, v]) => 
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  );

  // Complex Data: Arrays and Objects
  const complexData = allEntries.filter(([_, v]) => 
    Array.isArray(v) || (typeof v === 'object' && v !== null)
  );

  const itemType = displayType || r?.type || 'other';

  return (
    <div className={`group border rounded-xl bg-white transition-all duration-300 ${expanded ? 'shadow-lg border-primary-200 ring-1 ring-primary-100' : 'border-gray-200 hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5'}`}>
      {/* Collapsible Header Wrapper */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left block"
      >
        {/* ROW 1: Header */}
        <div className="px-4 py-3.5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`p-2 rounded-lg shadow-sm transition-colors ${expanded ? 'bg-primary-50 text-primary-600 ring-1 ring-primary-100' : 'bg-white border border-gray-200 text-gray-500 group-hover:border-gray-300 group-hover:text-gray-700'}`}>
              {getIconForType(itemType)}
            </div>
            
            <div className="min-w-0 flex-1">
               <div className="text-sm font-bold text-gray-900 truncate tracking-tight font-display">
                {String(title)}
              </div>
              
              {/* Header Preview (Collapsed & Expanded) */}
              {previewFields.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {previewFields.map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5 min-w-0 max-w-[200px]">
                      <span className="text-gray-500 shrink-0">{formatFieldName(k)}:</span>
                      <span className="text-gray-700 truncate">{formatSimpleValue(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
             {/* Optional: Status Badge in Header if present in data */}
             {r?.status && <StatusBadge value={r.status} />}
             <div className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>
               <ChevronDown className="w-4 h-4 text-gray-400" />
             </div>
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="animate-in slide-in-from-top-2 duration-200">
          
          {/* ROW 3: Divider */}
          <div className="border-t border-gray-100 mx-4" />

          <div className="p-4 space-y-6">
            
            {/* ROW 4: The Data Dump (String Grid) */}
            {stringData.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {stringData.map(([k, v]) => {
                  const isId = k.toLowerCase().includes('id') || k.toLowerCase().includes('key');
                  return (
                    <div key={k} className="flex flex-col gap-0.5">
                      <span className="text-xs text-gray-500">
                        {isId ? `# ${formatFieldName(k)}` : formatFieldName(k)}
                      </span>
                      <div className="text-sm text-gray-700 break-words flex items-center gap-2">
                        <span>{formatSimpleValue(v)}</span>
                        {isId && <SmartCopy text={String(v)} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ROW 5: Complex Data */}
            {complexData.length > 0 && (
              <div className="space-y-6">
                {complexData.map(([k, v]) => (
                  <div key={k} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                        {formatFieldName(k)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                        {Array.isArray(v) ? `${v.length} items` : 'Object'}
                      </span>
                    </div>
                    
                    {Array.isArray(v) ? (
                      <ArrayTable items={v} />
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <ObjectTable obj={v} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footer Actions */}
            <div className="pt-4 border-t border-gray-100 flex justify-end">
              <button
                className="text-xs text-gray-500 hover:text-primary-600 font-medium transition-colors flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-50"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowJson(!showJson);
                }}
              >
                <CodeIcon className="w-3.5 h-3.5" />
                {showJson ? t('aiResults.hide_json', 'Hide JSON') : t('aiResults.view_json', 'View JSON')}
              </button>
            </div>

            {showJson && (
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                <pre className="text-[10px] text-gray-600 font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                  {JSON.stringify(r, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CodeIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
);

// --- Table Components (Reused & Polished) ---

function ArrayTable({ items }: { items: any[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const totalPages = Math.ceil(items.length / pageSize);
  
  const firstItem = items[0];
  const isObjectArray = typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem);
  
  const currentItems = items.slice(page * pageSize, (page + 1) * pageSize);

  if (items.length === 0) return <div className="text-gray-400 italic text-xs px-2 py-1">Empty list</div>;

  const Pagination = () => (
    items.length > pageSize && (
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500 font-medium">
        <span>
          {page * pageSize + 1}-{Math.min((page + 1) * pageSize, items.length)} of {items.length}
        </span>
        <div className="flex gap-1">
          <button 
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-3 h-3 rotate-180" />
          </button>
          <button 
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  );

  if (isObjectArray) {
    const keys = Object.keys(firstItem).filter(k => !k.startsWith('_') && k !== 'sourceMeta');
    
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs divide-y divide-gray-100">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-8">#</th>
                {keys.slice(0, 5).map(k => (
                  <th key={k} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {formatFieldName(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {currentItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-3 py-2 text-gray-400 text-[10px]">{page * pageSize + idx + 1}</td>
                  {keys.slice(0, 5).map(k => {
                    const val = item[k];
                    const isId = k.toLowerCase().includes('id');
                    const isStatus = ['status', 'type', 'patternType', 'assignmentType'].includes(k);
                    
                    return (
                      <td key={k} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {isStatus ? (
                          <StatusBadge value={String(val)} />
                        ) : (
                          <div className="flex items-center group/cell">
                            <span className="">{formatSimpleValue(val)}</span>
                            {isId && val && (
                              <div className="opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                <SmartCopy text={String(val)} />
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination />
      </div>
    );
  } else {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm ring-1 ring-black/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs divide-y divide-gray-100">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Value</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {currentItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-400 text-[10px]">{page * pageSize + idx + 1}</td>
                  <td className="px-3 py-2 text-gray-700">{formatSimpleValue(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination />
      </div>
    );
  }
}

function ObjectTable({ obj }: { obj: any }) {
  const entries = Object.entries(obj).filter(([k]) => !k.startsWith('_') && k !== 'sourceMeta');

  return (
    <div className="overflow-x-auto bg-gray-50/30">
      <table className="min-w-full text-xs divide-y divide-gray-100">
        <tbody className="divide-y divide-gray-100">
          {entries.map(([k, v]) => (
            <tr key={k} className="hover:bg-white transition-colors">
              <td className="px-3 py-2 text-gray-500 font-medium whitespace-nowrap bg-gray-50/50 w-1/3 border-r border-gray-100 text-[10px] uppercase tracking-wide">
                {formatFieldName(k)}
              </td>
              <td className="px-3 py-2 text-gray-900 break-all">
                {formatNestedValue(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Format field name (camelCase -> Title Case)
function formatFieldName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace(/ I D/g, ' ID') // Fix ID spacing
    .trim();
}

// Format simple values
function formatSimpleValue(v: any): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  // Removed truncation logic as requested
  return String(v);
}

// Format nested values
function formatNestedValue(v: any): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[Array: ${v.length} items]`;
  if (typeof v === 'object') return '[Object]';
  return String(v);
}

