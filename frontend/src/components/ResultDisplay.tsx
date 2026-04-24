import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table, FileText, Download, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const isObjectIdLike = (v: any) => {
  try { const s = String(v ?? ''); return /^[a-fA-F0-9]{24}$/.test(s); } catch { return false; }
};

export type ResultDisplayProps = {
  results: any[];
  query: any;
  showIdsDefault?: boolean;
  onToggleShowIds?: (b: boolean) => void;
  conversation?: any;
  onViewHitl?: (id: string) => void;
};

const ResultDisplay: React.FC<ResultDisplayProps> = ({ results, query, showIdsDefault=false, onToggleShowIds, conversation, onViewHitl }) => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'table'|'json'>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [showIds, setShowIds] = useState(!!showIdsDefault);
  // Persist Show IDs preference per session
  useEffect(() => {
    try {
      const v = localStorage.getItem('phoenix_show_ids');
      if (v === 'true' || v === 'false') setShowIds(v === 'true');
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('phoenix_show_ids', String(showIds)); } catch {}
  }, [showIds]);

  const containerRef = useRef<HTMLDivElement|null>(null);
  const [showMenu, setShowMenu] = useState(false);

  // Close download menu with Escape
  useEffect(() => {
    if (!showMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMenu]);

  const [containerWidth, setContainerWidth] = useState(0);
  const BASE_COL_WIDTH = 250;

  useEffect(() => {
    if (!showMenu) return;
    const onDocClick = (e: MouseEvent) => {
      // Close when clicking elsewhere
      setShowMenu(false);
    };
    document.addEventListener('click', onDocClick, { once: true });
    return () => document.removeEventListener('click', onDocClick as any);
  }, [showMenu]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 0);
    update();
    let ro: ResizeObserver|undefined;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => update()); ro.observe(el); }
    else { window.addEventListener('resize', update); }
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', update); };
  }, [viewMode]);

  const isPlainObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  const isPrimitive = (v: any) => v === null || v === undefined || typeof v !== 'object';

  const tabData = useMemo(() => {
    const result: any = { isTabbed: false, keys: [], map: {}, counts: {}, allRows: [] };
    if (!results) return result;
    const normalizeRows = (arr: any[], sourceKey?: string) => (Array.isArray(arr) ? arr : []).map((v) => {
      const row = (v && typeof v === 'object' && !Array.isArray(v)) ? v : { value: v };
      return sourceKey ? { ...row, _source: sourceKey } : row;
    });
    if (Array.isArray(results) && results.length === 1 && results[0] && typeof results[0] === 'object' && !Array.isArray(results[0])) {
      const obj: any = results[0];
      const keys = Object.keys(obj || {});
      const candidateKeys = keys.filter(k => Array.isArray((obj as any)[k]) && ((obj as any)[k].length > 0));
      const filtered = candidateKeys.filter(k => {
        const arr: any[] = (obj as any)[k];
        const sample = arr.slice(0, Math.min(arr.length, 50));
        const objRatio = sample.filter(x => x && typeof x === 'object' && !Array.isArray(x)).length / Math.max(sample.length, 1);
        return objRatio >= 0.4;
      });
      if (filtered.length > 0) {
        result.isTabbed = true; result.keys = filtered;
        filtered.forEach((k: string) => { const rows = normalizeRows((obj as any)[k], k); result.map[k] = rows; result.counts[k] = rows.length; result.allRows = result.allRows.concat(rows); });
        return result;
      }
    }
    result.map['__SINGLE__'] = normalizeRows(Array.isArray(results) ? results : []);
    result.counts['__SINGLE__'] = result.map['__SINGLE__'].length;
    result.allRows = result.map['__SINGLE__'];
    return result;
  }, [results]);

  const [activeArrayKey, setActiveArrayKey] = useState('ALL');
  useEffect(() => { if (tabData.isTabbed) setActiveArrayKey(tabData.keys[0] || 'ALL'); else setActiveArrayKey('__SINGLE__'); }, [tabData.isTabbed, tabData.keys.join(',')]);

  const displayRows = useMemo(() => {
    if (!tabData.isTabbed) return tabData.map['__SINGLE__'] || [];
    if (activeArrayKey === 'ALL') return tabData.allRows || [];
    return tabData.map[activeArrayKey] || [];
  }, [tabData, activeArrayKey]);

  const filteredResults = useMemo(() => {
    const base = Array.isArray(displayRows) ? displayRows : [];
    if (!searchTerm) return base;
    const searchLower = searchTerm.toLowerCase();
    return base.filter((item: any) => { try { return Object.values(item || {}).some((value: any) => String(value).toLowerCase().includes(searchLower)); } catch { return false; } });
  }, [displayRows, searchTerm]);

  const paginatedResults = useMemo(() => {
    if (!Array.isArray(filteredResults)) return [];
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredResults.slice(startIndex, endIndex);
  }, [filteredResults, currentPage, itemsPerPage]);
  const totalPages = Math.ceil((filteredResults?.length || 0) / itemsPerPage);

  const summarizeObject = (obj: any) => {
    if (!isPlainObject(obj)) return '';
    const keys = Object.keys(obj);
    const byPriority = (k: string) => { const kl = k.toLowerCase(); if (/(title|name|label)$/.test(kl)) return 0; if (/(status|type)$/.test(kl)) return 1; if (/(date|time)$/.test(kl)) return 2; if (/(count|qty|quantity|amount)$/.test(kl)) return 3; return 9; };
    const top = keys.sort((a,b)=>byPriority(a)-byPriority(b)).slice(0,3);
    const parts = top.map(k => { const v: any = obj[k]; if (Array.isArray(v)) { const objs = v.filter((x:any)=>x && typeof x === 'object'); const name = objs[0]?.originalName || objs[0]?.fileName || objs[0]?.name; if (name) return `${k}: ${name}${v.length > 1 ? ` +${v.length - 1} more` : ''}`; return `${k}: ${v.length} items`; } if (v && typeof v === 'object') { const name = (v as any)?.originalName || (v as any)?.fileName || (v as any)?.name; if (name) return `${k}: ${name}`; return `${k}: Object`; } return `${k}: ${String(v)}`; });
    return parts.join(' • ');
  };

  const summarizeArray = (arr: any[]) => {
    if (!Array.isArray(arr)) return '';
    const count = arr.length; if (count === 0) return '0 items';
    const objs = arr.filter(isPlainObject);
    if (objs.length > 0) {
      const keyCandidates = ['type','status','transactionType'];
      const freq: any = {};
      keyCandidates.forEach(k => { objs.forEach((o:any) => { const v = o[k]; if (v !== undefined) { const s = String(v); freq[k] = freq[k] || {}; freq[k][s] = (freq[k][s] || 0) + 1; } }); });
      const bestKey = keyCandidates.find(k => freq[k]);
      if (bestKey) { const entries = Object.entries(freq[bestKey]).sort((a:any,b:any)=> (b as any)[1] - (a as any)[1]).slice(0,3); const tag = entries.map(([val, n]) => `${val}×${n}`).join(', '); return `${count} items • ${bestKey}: ${tag}`; }
    }
    return `${count} items`;
  };

  const [expandedCell, setExpandedCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [listViewMode, setListViewMode] = useState<'grouped'|'combined'>('grouped');

  const getNestedArrayKeys = (arr: any[]) => {
    const keys = new Set<string>();
    arr.forEach((it:any) => { if (isPlainObject(it)) { Object.entries(it).forEach(([k, v]) => { if (Array.isArray(v) && v.length) keys.add(k); }); } });
    return Array.from(keys);
  };

  const flattenJobContext = (item: any) => {
    const ctx: any = {};
    const j = isPlainObject(item?.job) ? item.job : null;
    if (j) {
      if (j.jobTitle != null) ctx.jobTitle = j.jobTitle;
      if (j.vesselName != null) ctx.vesselName = j.vesselName;
      if (j.jobStatus != null) ctx.jobStatus = j.jobStatus;
      if (j.performedOn != null) ctx.performedOn = j.performedOn;
      if (j.plannedDueDate != null) ctx.plannedDueDate = j.plannedDueDate;
    }
    Object.entries(item || {}).forEach(([k, v]) => { if (k !== 'job' && !Array.isArray(v) && isPrimitive(v)) ctx[k] = v; });
    return ctx;
  };

  const renderCell = (value: any, rowIndex: number, column: string) => {
    if (isPrimitive(value)) return formatValue(value);
    if (isPlainObject(value)) {
      const summary = summarizeObject(value) || 'Object';
      return (
        <button type="button" className="inline-flex items-center gap-2 px-2 py-1 rounded border text-xs bg-white hover:bg-gray-50" title="View details" onClick={() => setExpandedCell(prev => (prev && prev.rowIndex === rowIndex && prev.column === column) ? null : { rowIndex, column })}>
          <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full" />
          <span className="truncate max-w-[200px] text-left">{summary}</span>
        </button>
      );
    }
    if (Array.isArray(value)) {
      const summary = summarizeArray(value);
      return (
        <button type="button" className="inline-flex items-center gap-2 px-2 py-1 rounded border text-xs bg-white hover:bg-gray-50" title="View list" onClick={() => setExpandedCell(prev => (prev && prev.rowIndex === rowIndex && prev.column === column) ? null : { rowIndex, column })}>
          <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full" />
          <span className="truncate max-w-[200px] text-left">{summary}</span>
        </button>
      );
    }
    return String(value);
  };

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? t('bool.yes') : t('bool.no');
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
  };

  const formatDateTime = (v: any) => { try { const d = new Date(v); if (!isNaN(d as any)) return d.toLocaleString(); } catch {} return String(v ?? '-'); };
  const formatBytes = (bytes: any) => { const n = Number(bytes); if (!Number.isFinite(n)) return String(bytes ?? ''); if (n < 1024) return `${n} B`; const kb = n / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`; const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`; const gb = mb / 1024; return `${gb.toFixed(1)} GB`; };

  const renderFormData = (formData: any) => {
    const isPlain = isPlainObject(formData);
    if (!isPlain) return <pre className="text-xs bg-gray-900 text-green-400 p-2 rounded overflow-x-auto">{JSON.stringify(formData, null, 2)}</pre>;
    const entries = Object.entries(formData);
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {entries.map(([fid, val]) => (
          <div key={fid} className="text-sm">
            <div className="text-gray-500 text-xs break-words">{fid}</div>
            <div className="text-gray-9 00 break-words">
              {typeof val === 'boolean' ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${val ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-700 border-gray-300'}`}>{val ? t('bool.yes') : t('bool.no')}</span>
              ) : Array.isArray(val) ? (
                renderFileList(val)
              ) : isPlainObject(val) ? (
                <pre className="text-xs bg-gray-900 text-green-400 p-2 rounded overflow-x-auto">{JSON.stringify(val, null, 2)}</pre>
              ) : (
                String(val)
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderFileList = (arr: any[]) => {
    if (!Array.isArray(arr) || arr.length === 0) return <span className="text-gray-500">-</span>;
    return (
      <ul className="space-y-1">
        {arr.slice(0, 10).map((f: any, i: number) => (
          <li key={i} className="text-xs flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{String(f?.originalName || f?.fileName || f?.name || f?.id || 'file')}</span>
            {f?.contentType && <span className="text-gray-500">{String(f.contentType)}</span>}
            {f?.size != null && <span className="text-gray-500">{formatBytes(f.size)}</span>}
            {f?.uploadedAt && <span className="text-gray-500">{formatDateTime(f.uploadedAt)}</span>}
          </li>
        ))}
        {arr.length > 10 && (<li className="text-[11px] text-gray-500">+{arr.length - 10} more</li>)}
      </ul>
    );
  };


  const renderValidatedForms = (forms: any) => {
    const arr = Array.isArray(forms) ? forms : (isPlainObject(forms) && Array.isArray((forms as any).forms) ? (forms as any).forms : []);
    if (!Array.isArray(arr) || arr.length === 0) return <span className="text-gray-500">-</span>;
    return (
      <div className="space-y-2">
        {arr.slice(0, 10).map((f:any, i:number) => (
          <div key={i} className="border rounded p-2 bg-white">
            <div className="text-xs text-gray-700 font-medium mb-1">{String(f?.formTemplateName || f?.formTemplateID || 'Form')}</div>
            {f?.formData ? renderFormData(f.formData) : (
              <div className="text-xs text-gray-500">No form data</div>
            )}
          </div>
        ))}
        {arr.length > 10 && (<div className="text-[11px] text-gray-500">+{arr.length - 10} more</div>)}
      </div>
    );
  };

  const renderDetailPanel = (value: any, column: string) => {
    if (column === 'validatedForms') {
      return (<div className="p-3 bg-gray-50 border rounded"><div className="text-xs font-semibold text-gray-700 mb-2">{column}</div>{renderValidatedForms(value)}</div>);
    }
    if (Array.isArray(value)) {
      const formsLike = value.some((f:any) => isPlainObject(f) && (f.formTemplateID || f.formData));
      if (formsLike) { return (<div className="p-3 bg-gray-50 border rounded"><div className="text-xs font-semibold text-gray-700 mb-2">{column}</div>{renderValidatedForms(value)}</div>); }
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value || {});
      return (
        <div className="p-3 bg-gray-50 border rounded">
          <div className="text-xs font-semibold text-gray-700 mb-2">{column}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {entries.map(([k, v]) => (
              <div key={k} className="text-sm">
                <div className="text-gray-500 text-xs">{k}</div>
                <div className="text-gray-900 break-words">
                  {k === 'validatedForms' ? renderValidatedForms(v) : k === 'formData' ? renderFormData(v) : isPrimitive(v) ? String(v) : Array.isArray(v) ? summarizeArray(v) : summarizeObject(v) || 'Object'}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (Array.isArray(value)) {
      const arr = value;
      const objs = arr.filter(isPlainObject);
      const nestedKeys = getNestedArrayKeys(objs);
      if (objs.length > 0 && nestedKeys.length > 0) {
        return (
          <div className="p-3 bg-gray-50 border rounded overflow-x-auto w-full">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-semibold text-gray-700">{column} — {arr.length} items</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">View:</span>
                <button type="button" className={`px-2 py-1 rounded border ${listViewMode === 'grouped' ? 'bg-white' : 'bg-gray-100'}`} onClick={() => setListViewMode('grouped')}>Grouped</button>
                <button type="button" className={`px-2 py-1 rounded border ${listViewMode === 'combined' ? 'bg-white' : 'bg-gray-100'}`} onClick={() => setListViewMode('combined')}>Combined</button>
              </div>
            </div>
            {listViewMode === 'grouped' ? (
              <div className="space-y-4">
                {objs.slice(0, 10).map((item:any, i:number) => {
                  const ctx = flattenJobContext(item);
                  return (
                    <div key={i} className="border rounded p-2 bg-white">
                      {Object.keys(ctx).length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
                          {Object.entries(ctx).map(([k,v]) => (<div key={k} className="text-xs"><span className="text-gray-500">{k}:</span> <span className="text-gray-800 break-words">{String(v)}</span></div>))}
                        </div>
                      )}
                      {nestedKeys.map((nk) => {
                        const subArr = Array.isArray(item[nk]) ? item[nk] : [];
                        const subKeySet = new Set<string>();
                        subArr.slice(0, 50).forEach((o:any) => { if (isPlainObject(o)) Object.keys(o).forEach(k => subKeySet.add(k)); });
                        const subCols = Array.from(subKeySet).slice(0, 8);
                        return (
                          <div key={nk} className="overflow-x-auto w-full mt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-1">{nk} — {subArr.length} items</div>
                            <table className="min-w-max table-auto text-xs">
                              <thead className="bg-gray-100">
                                <tr>
                                  {subCols.map(sc => (<th key={sc} className="px-2 py-1 text-left text-[11px] font-medium text-gray-600 whitespace-nowrap" style={{ minWidth: 140 }}>{sc}</th>))}
                                </tr>
                              </thead>
                              <tbody>
                                {subArr.slice(0, 20).map((o:any, ri:number) => (
                                  <tr key={ri} className="odd:bg-white even:bg-gray-50">
                                    {subCols.map(sc => (<td key={sc} className="px-2 py-1 align-top break-words" style={{ minWidth: 140 }}>{isPrimitive(o?.[sc]) ? String(o?.[sc] ?? '-') : isPlainObject(o?.[sc]) ? summarizeObject(o?.[sc]) : Array.isArray(o?.[sc]) ? summarizeArray(o?.[sc]) : '-'}</td>))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {subArr.length > 20 && (<div className="text-[11px] text-gray-500 mt-1">Showing 20 of {subArr.length}. Export to see all.</div>)}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {objs.length > 10 && (<div className="text-[11px] text-gray-500">Showing 10 of {objs.length}. Export to see all.</div>)}
              </div>
            ) : (
              (() => {
                const combinedRows: any[] = [];
                objs.forEach((item:any) => {
                  const ctx = flattenJobContext(item);
                  nestedKeys.forEach(nk => {
                    const subArr = Array.isArray(item[nk]) ? item[nk] : [];
                    subArr.forEach((s:any) => { combinedRows.push({ __ctx: ctx, __kind: nk, ...(isPlainObject(s) ? s : { value: s }) }); });
                  });
                });
                const ctxKeys = new Set<string>();
                combinedRows.forEach((r:any) => Object.keys(r.__ctx || {}).forEach(k => ctxKeys.add(k)));
                const dataKeys = new Set<string>();
                combinedRows.forEach((r:any) => Object.keys(r).forEach(k => { if (!(k as string).startsWith('__')) dataKeys.add(k as string); }));
                const subCols = Array.from(ctxKeys).concat(Array.from(dataKeys)).slice(0, 12);
                return (
                  <div className="overflow-x-auto w-full max-w-full scrollbar-thin">
                    <div className="text-xs font-semibold text-gray-700 mb-1">Combined — {combinedRows.length} rows</div>
                    <table className="min-w-max table-auto text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          {subCols.map(sc => (<th key={sc} className="px-2 py-1 text-left text-[11px] font-medium text-gray-600 whitespace-nowrap" style={{ minWidth: 140 }}>{sc}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {combinedRows.slice(0, 50).map((r:any, i:number) => (
                          <tr key={i} className="odd:bg-white even:bg-gray-50">
                            {subCols.map(sc => (
                              <td key={sc} className="px-2 py-1 align-top break-words" style={{ minWidth: 140 }}>
                                {sc in (r.__ctx || {}) ? String((r.__ctx as any)[sc]) : String((r as any)[sc] ?? '-')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {combinedRows.length > 50 && (<div className="text-[11px] text-gray-500 mt-1">Showing 50 of {combinedRows.length}. Export to see all.</div>)}
                  </div>
                );
              })()
            )}
          </div>
        );
      }

      if (objs.length > 0) {
        const keySet = new Set<string>();
        arr.slice(0, 50).forEach((o:any) => { if (isPlainObject(o)) Object.keys(o).forEach(k => keySet.add(k)); });
        const subCols = Array.from(keySet).slice(0, 8);
        return (
          <div className="p-3 bg-gray-50 border rounded overflow-x-auto w-full">
            <div className="text-xs font-semibold text-gray-700 mb-2">{column} — {arr.length} items</div>
            <table className="min-w-max table-auto text-sm">
              <thead className="bg-gray-100">
                <tr>{subCols.map(sc => (<th key={sc} className="px-3 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap" style={{ minWidth: 160 }}>{sc}</th>))}</tr>
              </thead>
              <tbody>
                {arr.slice(0, 20).map((o:any, i:number) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    {subCols.map(sc => (<td key={sc} className="px-3 py-2 align-top break-words" style={{ minWidth: 160 }}>{isPrimitive(o?.[sc]) ? String(o?.[sc] ?? '-') : isPlainObject(o?.[sc]) ? summarizeObject(o?.[sc]) : Array.isArray(o?.[sc]) ? summarizeArray(o?.[sc]) : '-'}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
            {arr.length > 20 && (<div className="text-xs text-gray-500 mt-2">Showing 20 of {arr.length}. Export to see all.</div>)}
          </div>
        );
      }

      return (
        <div className="p-3 bg-gray-50 border rounded">
          <div className="text-xs font-semibold text-gray-700 mb-2">{column} — {arr.length} items</div>
          <ul className="list-disc pl-5 space-y-1 text-sm">{arr.slice(0, 20).map((v:any,i:number)=>(<li key={i} className="break-words">{String(v)}</li>))}</ul>
          {arr.length > 20 && (<div className="text-xs text-gray-500 mt-2">Showing 20 of {arr.length}. Export to see all.</div>)}
        </div>
      );
    }

    return (<pre className="p-3 bg-gray-900 text-green-400 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>);
  };

  const columns = useMemo(() => {
    const rows = Array.isArray(displayRows) ? displayRows : [];
    if (rows.length === 0) return [] as string[];
    const keySet = new Set<string>();
    for (const row of rows) { Object.keys(row || {}).forEach(k => keySet.add(k)); }
    let cols = Array.from(keySet);
    if (!showIds) cols = cols.filter(k => {
      if (/^_?id$/i.test(k) || k === '_source') return false;
      if (/id$/i.test(k)) {
        const sample = rows.slice(0, Math.min(rows.length, 50));
        const idLikeCount = sample.reduce((acc, row) => acc + (isObjectIdLike((row as any)?.[k]) ? 1 : 0), 0);
        const ratio = idLikeCount / Math.max(sample.length, 1);
        return ratio < 0.6;
      }
      return true;
    });
    const PRIORITY_FIELDS = ['vesselName', 'activityName', 'performedOn', 'duration', 'performedByEmail', 'notes', 'status', 'performedBy', 'createdAt', 'updatedAt'];
    const priorityIndex = (k: string) => { const idx = PRIORITY_FIELDS.findIndex(f => f.toLowerCase() === String(k).toLowerCase()); return idx === -1 ? 999 : idx; };
    cols.sort((a, b) => { const pa = priorityIndex(a); const pb = priorityIndex(b); if (pa !== pb) return pa - pb; return String(a).localeCompare(String(b)); });
    return cols;
  }, [displayRows, showIds]);

  const colWidth = useMemo(() => {
    if (!columns || columns.length === 0) return BASE_COL_WIDTH;
    if (containerWidth <= 0) return BASE_COL_WIDTH;
    const minTotal = columns.length * BASE_COL_WIDTH;
    if (minTotal <= containerWidth) return Math.floor(containerWidth / columns.length);
    return BASE_COL_WIDTH;
  }, [columns, containerWidth]);

  const exportRows = useMemo(() => (Array.isArray(displayRows) ? displayRows : []), [displayRows]);
  const renderArrayTabs = useMemo(() => {
    if (!(tabData as any).isTabbed) return null as any;
    const tabs = ['ALL', ...(tabData as any).keys];
    return (
      <div className="flex items-center space-x-2">
        {tabs.map((k) => (
          <button key={k} onClick={() => { setCurrentPage(1); setActiveArrayKey(k); }} className={`px-3 py-1 text-sm rounded border transition-colors ${activeArrayKey === k ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            {k === 'ALL' ? t('all') : k} {k !== 'ALL' && (tabData as any).counts[k] !== undefined ? `(${(tabData as any).counts[k]})` : ''}
          </button>
        ))}
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabData.isTabbed, tabData.keys, activeArrayKey]);

  const handleDownload = (format: 'json'|'csv') => {
    const data = exportRows; if (!data || data.length === 0) return;
    let content: string, filename: string, mimeType: string;
    switch (format) {
      case 'json': content = JSON.stringify(data, null, 2); filename = 'skylark-results.json'; mimeType = 'application/json'; break;
      case 'csv': content = convertToCSV(data); filename = 'skylark-results.csv'; mimeType = 'text/csv'; break;
      default: return;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  };

  const convertToCSV = (data: any[]) => {
    if (!Array.isArray(data) || data.length === 0) return '';
    const keySet = new Set<string>();
    data.forEach(row => Object.keys(row || {}).forEach(k => keySet.add(k)));
    const headersAll = Array.from(keySet);
    const headers = headersAll.filter(k => !/^_?id$/i.test(k) && !/id$/i.test(k) && k !== '_source');
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => headers.map(header => { const value:any = (row as any)[header]; const stringValue = String(value ?? ''); if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) { return `"${stringValue.replace(/\"/g, '""')}"`; } return stringValue; }).join(','));
    return [csvHeaders, ...csvRows].join('\n');
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            {renderArrayTabs && (<div className="mr-2">{renderArrayTabs}</div>)}
            <div className="flex items-center space-x-1 bg-white rounded-lg border border-gray-200 p-1">
              <button onClick={() => setViewMode('table')} className={`px-3 py-1 text-sm rounded transition-colors ${viewMode === 'table' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}><Table className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('json')} className={`px-3 py-1 text-sm rounded transition-colors ${viewMode === 'json' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}>{t('result.json')}</button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder={t('result.search_placeholder') as string} value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm" />
          </div>
          <span className="text-sm text-gray-600">{t('result.results_count', { filtered: filteredResults.length, total: results.length })}</span>
        </div>
        <div className="flex items-center space-x-2">
          {conversation && conversation.relatedConversationId && onViewHitl && (
            <button onClick={() => onViewHitl(conversation.relatedConversationId)} className="btn-ghost text-sm flex items-center space-x-1" title={t('app.view_hitl') as string}>
              <span>{t('app.view_hitl')}</span>
            </button>
          )}
          <label className="flex items-center space-x-2 text-sm text-gray-600 select-none">
            <input type="checkbox" className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" checked={showIds} onChange={(e) => { setShowIds(e.target.checked); onToggleShowIds?.(e.target.checked); }} />
            <span>{t('result.show_ids')}</span>
          </label>
          {/* Unified Download button with dropdown */}
          <div className="relative">
            <button onClick={() => setShowMenu(v => !v)} className="btn-ghost text-sm flex items-center space-x-1" aria-haspopup="menu" aria-expanded={showMenu}>
              <Download className="w-4 h-4" />
              <span>{t('request.download')}</span>
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10" role="menu">
                <button onClick={() => { handleDownload('json'); setShowMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" role="menuitem">{t('result.download_json')}</button>
                <button onClick={() => { handleDownload('csv'); setShowMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" role="menuitem">{t('result.download_csv')}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto w-full max-w-full scrollbar-thin" ref={containerRef}>
        {viewMode === 'table' ? (
          <div className="overflow-x-auto w-full scrollbar-thin">
            <table className="min-w-max table-auto divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>{columns.map((column) => (<th key={column} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-normal break-words align-top" style={{ minWidth: 250, width: colWidth, maxWidth: colWidth, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{column}</th>))}</tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedResults.map((row, index) => (
                  <React.Fragment key={index}>
                    <tr className="hover:bg-gray-50">{columns.map((column) => (<td key={column} className="px-6 py-4 text-sm text-gray-900 whitespace-normal break-words align-top" style={{ minWidth: 250, width: colWidth, maxWidth: colWidth, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{renderCell((row as any)[column], index, column)}</td>))}</tr>
                    {expandedCell && expandedCell.rowIndex === index && (
                      <tr className="bg-gray-50">
                        <td colSpan={columns.length} className="px-6 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 overflow-x-auto">
                            <div className="text-sm font-medium text-gray-700">Details: {expandedCell.column}</div>
                            <button type="button" className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900" onClick={() => setExpandedCell(null)}>
                              <X className="w-3 h-3" /> Close
                            </button>
                          </div>
                          <div className="overflow-x-auto w-full max-w-full scrollbar-thin">{renderDetailPanel((row as any)[expandedCell.column], expandedCell.column)}</div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4"><pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto font-mono whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{JSON.stringify(filteredResults, null, 2)}</pre></div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-2"><span className="text-sm text-gray-700">{t('result.page_of', { current: currentPage, total: totalPages })}</span></div>
          <div className="flex items-center space-x-2">
            <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) pageNum = i + 1;
                else if (currentPage <= 3) pageNum = i + 1;
                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = currentPage - 2 + i;
                return (
                  <button key={pageNum} onClick={() => setCurrentPage(pageNum as number)} className={`px-3 py-1 text-sm rounded transition-colors ${currentPage === pageNum ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>{pageNum as number}</button>
                );
              })}
            </div>
            <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;

