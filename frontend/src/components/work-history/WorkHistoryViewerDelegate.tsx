import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileText, AlertTriangle, Clock } from 'lucide-react';
import FormViewerDelegate, { type FormViewerHandle } from '../forms/FormViewerDelegate';

export type WorkHistoryViewerHandle = {
  open: (row?: any | null) => void;
  close: () => void;
};

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

function getSeverityChipClass(severity?: string) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') return 'bg-red-100 text-red-800 border-red-300';
  if (s === 'major') return 'bg-orange-100 text-orange-800 border-orange-300';
  if (s === 'moderate') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  if (s === 'minor') return 'bg-blue-100 text-blue-800 border-blue-300';
  return 'bg-gray-100 text-gray-800 border-gray-300';
}

function capitalizeFirst(s?: string) {
  const str = String(s || '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default forwardRef<WorkHistoryViewerHandle, { initialOpen?: boolean }>(function WorkHistoryViewerDelegate({ initialOpen }, ref) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(!!initialOpen);
  const [row, setRow] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [awh, setAwh] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [docsLoading, setDocsLoading] = useState<boolean>(false);
  const [documents, setDocuments] = useState<string[]>([]);
  const [showParts, setShowParts] = useState<boolean>(false);
  const [partsFromApi, setPartsFromApi] = useState<any[]>([]);
  const lastActive = useRef<HTMLElement | null>(null);
  const [formsFromApi, setFormsFromApi] = useState<any[]>([]);

  const formViewerRef = useRef<FormViewerHandle>(null);

  function isLikelyObjectId(v: any): boolean {
    return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
  }

  // Debug helper: logs request and response payloads for PhoenixCloudBE proxy calls
  async function fetchJSONWithLogs(url: string, label: string) {
    const started = Date.now();
    // Keep headers/tokens out of logs for safety; log URL and timing only
    // console.log('[AWH][REQ]', label, { url });
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch {}
      const log = { status: resp.status, ok: resp.ok, url: resp.url, durationMs: Date.now() - started, body };
      // console.log('[AWH][RESP]', label, log);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return body;
    } catch (err: any) {
      // console.log('[AWH][ERR]', label, { message: err?.message || String(err) });
      throw err;
    }
  }

  const ids = useMemo(() => {
    // Extract IDs ONLY from sourceMeta - ignore all other JSON data
    const org = row?.sourceMeta?.organizationID;
    const awhId = row?.sourceMeta?.entities?.activityWorkHistoryId;
    const eventId = row?.sourceMeta?.entities?.activityWorkHistoryEventId;

    // console.log('[AWH][IDS]', {
    //   org,
    //   awhId,
    //   eventId,
    //   hasValidOrg: !!org && typeof org === 'string',
    //   hasValidAwhId: !!awhId && isLikelyObjectId(awhId),
    //   hasValidEventId: !!eventId && isLikelyObjectId(eventId)
    // });

    return {
      org: (org && typeof org === 'string') ? org : undefined,
      awhId: isLikelyObjectId(awhId) ? awhId : undefined,
      eventId: isLikelyObjectId(eventId) ? eventId : undefined
    };
  }, [row]);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => lastActive.current?.focus?.(), 0);
  }, []);

  async function fetchAWH(org: string, awhId: string) {
    const [whRes, evRes] = await Promise.allSettled([
      fetchJSONWithLogs(`/api/phoenix-cloud/activityworkhistory/${org}/${awhId}`, 'GET activityworkhistory'),
      fetchJSONWithLogs(`/api/phoenix-cloud/activityworkhistoryevent/${org}/${awhId}/all`, 'GET activityworkhistoryevent/all'),
    ]);
    const wh = whRes.status === 'fulfilled' ? whRes.value : null;
    const ev = evRes.status === 'fulfilled' ? (evRes.value || []) : [];
    // console.log('[AWH][MERGE]', { hasAwh: !!wh, eventsCount: Array.isArray(ev) ? ev.length : 0 });

    // Derive Next Activity Planned On similar to Cloud FE2
    let nextPlanned: string | null = null;
    try {
      const activityId = wh?.activityID?._id || wh?.activityID || null;
      if (org && activityId) {
        const list = await fetchJSONWithLogs(`/api/phoenix-cloud/activityworkhistory/${org}/activity/${activityId}`, 'GET activityworkhistory by activity');
        const arr = Array.isArray(list) ? list : [];
        // Prefer to find current index then next entry; otherwise find the next by plannedDueDate > current
        const curIdx = arr.findIndex((x: any) => String(x?._id) === String(awhId));
        if (curIdx >= 0 && curIdx + 1 < arr.length) {
          nextPlanned = arr[curIdx + 1]?.plannedDueDate || null;
        } else {
          const curDue = wh?.plannedDueDate ? new Date(wh.plannedDueDate).getTime() : null;
          const sorted = [...arr].filter((x: any) => x?.plannedDueDate).sort((a: any, b: any) => new Date(a.plannedDueDate).getTime() - new Date(b.plannedDueDate).getTime());
          if (curDue != null) {
            const nxt = sorted.find((x: any) => new Date(x.plannedDueDate).getTime() > curDue);
            nextPlanned = nxt?.plannedDueDate || null;
          } else {
            nextPlanned = sorted?.[0]?.plannedDueDate || null;
          }
        }
      }
    } catch (e) {
      // non-fatal; leave nextPlanned null
    }

    return { wh: wh ? { ...wh, nextPlannedDueDate: wh?.nextPlannedDueDate || nextPlanned } : null, ev };
  }

  async function listEventDocuments(org: string, eventID: string) {
    try {
      const docs = await fetchJSONWithLogs(
        `/api/phoenix-cloud/activityworkhistoryevent/${org}/${eventID}/documents`,
        'GET activityworkhistoryevent/documents'
      );
      return Array.isArray(docs) ? docs : [];
    } catch (e) {
      // Already logged; return empty list for UI safety
      return [];
    }
  }

  function downloadEventDocument(org: string, eventID: string, documentName: string) {
    const url = `/api/phoenix-cloud/activityworkhistoryevent/${org}/${eventID}/download/${encodeURIComponent(documentName)}`;
    window.open(url, '_blank');
  }


  const openWith = useCallback((r?: any | null) => {
    lastActive.current = (document.activeElement as HTMLElement) || null;
    setRow(r ?? null);
    setOpen(true);
    (async () => {
      try {
        // Extract IDs ONLY from sourceMeta - ignore all other JSON data
        const org = r?.sourceMeta?.organizationID;
        const awhId = r?.sourceMeta?.entities?.activityWorkHistoryId;
        const providedEventId = r?.sourceMeta?.entities?.activityWorkHistoryEventId;

        // console.log('[AWH][OPEN]', { org, awhId, providedEventId, hasValidIds: !!(org && awhId) });

        if (org && awhId && isLikelyObjectId(awhId)) {
          setLoading(true);
          const { wh, ev } = await fetchAWH(org, awhId);

          // Set AWH data from BE response
          if (wh) {
            setAwh(wh);
          }

          // Set events from BE response
          const list = Array.isArray(ev) ? ev : [];
          const sorted = [...list].sort((a: any, b: any) =>
            new Date(a?.createdAt || a?.performedOn || 0).getTime() -
            new Date(b?.createdAt || b?.performedOn || 0).getTime()
          );
          setEvents(sorted);

          // Select event: use provided event ID if available, otherwise use latest
          let selectedEvent = null;
          if (providedEventId && isLikelyObjectId(providedEventId)) {
            selectedEvent = sorted.find((e: any) => String(e?._id) === String(providedEventId));
            // console.log('[AWH][EVENT_SELECTION]', {
            //   providedEventId,
            //   foundInList: !!selectedEvent,
            //   totalEvents: sorted.length,
            //   strategy: 'provided-event-id'
            // });
          }

          // Fallback to latest event if provided event not found
          if (!selectedEvent) {
            selectedEvent = sorted.length ? sorted[sorted.length - 1] : null;
            // console.log('[AWH][EVENT_SELECTION]', {
            //   selectedEventId: selectedEvent?._id,
            //   totalEvents: sorted.length,
            //   strategy: 'latest-event'
            // });
          }

          setSelectedEventId(selectedEvent?._id || null);
        } else {
          // console.log('[AWH][NO_VALID_IDS]', { org, awhId, providedEventId });
          // No valid IDs - cannot fetch data
          setAwh(null);
          setEvents([]);
          setSelectedEventId(null);
        }
      } catch (e) {
        console.warn('[AWH][LOAD_ERR]', (e as any)?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useImperativeHandle(ref, () => ({ open: openWith, close }), [openWith, close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    // Load documents when selected event changes
    (async () => {
      const org = ids.org; const evId = selectedEventId;
      if (!open || !org || !evId) return;
      try {
        setDocsLoading(true);
        const docs = await listEventDocuments(org, evId);
        setDocuments(Array.isArray(docs) ? docs : []);
      } finally {
        setDocsLoading(false);
      }
      })();
  }, [open, ids.org, selectedEventId]);


  // Load inventory transactions by AWH to build parts usage when not embedded
  useEffect(() => {
    (async () => {
      if (!open || !ids.org || !ids.awhId || !selectedEventId) return;
      try {
        const url = `/api/phoenix-cloud/inventory/${ids.org}/transactions?relatedActivityWorkHistoryID=${ids.awhId}&limit=200`;
        const list = await fetchJSONWithLogs(url, 'GET inventory transactions by AWH');
        const arr = Array.isArray(list) ? list : [];
        const eventIdStr = selectedEventId ? String(selectedEventId) : null;
        const hasEventLink = arr.some((t:any) => t?.relatedActivityWorkHistoryEventID || t?.relatedActivityWorkHistoryEventId);

        // Try to filter by event ID if available
        let filtered = arr;
        if (hasEventLink && eventIdStr) {
          const eventFiltered = arr.filter((t:any) => {
            const evRaw = (t?.relatedActivityWorkHistoryEventID ?? t?.relatedActivityWorkHistoryEventId);
            const evId = (evRaw && typeof evRaw === 'object' && evRaw._id) ? evRaw._id : evRaw;
            return String(evId || '') === eventIdStr;
          });
          // When transactions carry event linkage, do not fall back to all-AWH; show only the matching event rows (can be 0)
          filtered = eventFiltered;
        }

        // console.log('[AWH][PARTS][API_TXNS]', { total: arr.length, filtered: filtered.length, hasEventLink, eventIdStr, awhId: ids.awhId, strategy: filtered.length === arr.length ? 'all-awh' : 'event-filtered' });
        const mapped = filtered.map((t:any) => {
          // Handle populated references (partID, fromLocationID, toLocationID, relatedActivityWorkHistoryID, relatedActivityWorkHistoryEventID can be objects)
          const partObj = typeof t?.partID === 'object' ? t.partID : null;
          const fromLocObj = typeof t?.fromLocationID === 'object' ? t.fromLocationID : null;
          const toLocObj = typeof t?.toLocationID === 'object' ? t.toLocationID : null;
          const relatedAWHObj = typeof t?.relatedActivityWorkHistoryID === 'object' ? t.relatedActivityWorkHistoryID : null;
          const relatedAWHEObj = typeof t?.relatedActivityWorkHistoryEventID === 'object' ? t.relatedActivityWorkHistoryEventID : null;

          return {
            sfiCode: partObj?.sfiCode || t?.sfiCode || '-',
            partName: partObj?.partName || t?.partName || '-',
            partNumber: partObj?.partNumber || t?.partNumber || '-',
            unit: partObj?.unit || t?.unit || '-',
            quantityUsed: t?.transactionType === 'issue' ? Math.abs(t?.quantity ?? 0) : 0,
            quantityReturned: t?.transactionType === 'return' ? Math.abs(t?.quantity ?? 0) : 0,
            unitCost: typeof t?.unitCost === 'number' ? t.unitCost : undefined,
            totalCost: typeof t?.totalCost === 'number' ? t.totalCost : undefined,
            location: t?.transactionType === 'issue'
              ? (fromLocObj?.locationName || t?.fromLocationName || fromLocObj?.locationCode || '-')
              : (toLocObj?.locationName || t?.toLocationName || toLocObj?.locationCode || fromLocObj?.locationName || t?.fromLocationName || '-'),
            // Additional fields to show full inventory transaction context
            organizationID: t?.organizationID || t?.organization_ID || '-',
            partID: partObj?._id || t?.partID || '-',
            transactionType: t?.transactionType || '-',
            quantity: typeof t?.quantity === 'number' ? t.quantity : undefined,
            fromLocationID: fromLocObj?.locationName || t?.fromLocationName || fromLocObj?._id || t?.fromLocationID || '-',
            toLocationID: toLocObj?.locationName || t?.toLocationName || toLocObj?._id || t?.toLocationID || '-',
            relatedActivityWorkHistoryID: relatedAWHObj?._id || t?.relatedActivityWorkHistoryID || '-',
            relatedActivityWorkHistoryEventID: relatedAWHEObj?._id || t?.relatedActivityWorkHistoryEventID || '-',
            performedBy: (typeof t?.performedBy === 'object' ? (t?.performedBy as any)?.email : t?.performedBy) || '-',
            reason: t?.reason || '-',
            comments: t?.comments || '-',
            documentReferences: Array.isArray(t?.documentReferences) ? t.documentReferences.join(', ') : '-',
            transactionDate: t?.transactionDate || undefined,
            createdAt: t?.createdAt || undefined,
            updatedAt: t?.updatedAt || undefined,
            effectiveTransactionTime: t?.effectiveTransactionTime || undefined,
          };
        });
        // console.log('[AWH][PARTS][API_TXNS_MAPPED]', { rows: mapped.length, sample: mapped[0] });
        setPartsFromApi(mapped);
      } catch (e) {
        // console.log('[AWH][PARTS][API_TXNS_ERR]', (e as any)?.message);
        setPartsFromApi([]);
      } finally {
      }
    })();
  }, [open, ids.org, ids.awhId, selectedEventId]);


  // Build parts usage from inventory transactions if event.partsUsed is absent
  const partsFromTxns = React.useMemo(() => {
    const txns = (awh as any)?.inventoryTransactions || (row as any)?.inventoryTransactions || [];
    if (!Array.isArray(txns) || txns.length === 0) return [] as any[];
    const eventIdStr = selectedEventId ? String(selectedEventId) : null;
    const awhIdStr = ids.awhId ? String(ids.awhId) : null;
    const hasEventLink = txns.some((t:any) => t?.relatedActivityWorkHistoryEventID || t?.relatedActivityWorkHistoryEventId);
    let filtered = txns;
    if (hasEventLink && eventIdStr) {
      filtered = txns.filter((t:any) => {
        const evRaw = (t?.relatedActivityWorkHistoryEventID ?? t?.relatedActivityWorkHistoryEventId);
        const evId = (evRaw && typeof evRaw === 'object' && evRaw._id) ? evRaw._id : evRaw;
        return String(evId || '') === eventIdStr;
      });
    } else if (awhIdStr) {
      filtered = txns.filter((t:any) => String(t?.relatedActivityWorkHistoryID || '') === awhIdStr);
    }
    // console.log('[AWH][PARTS][LOCAL_TXNS]', { total: txns.length, filtered: filtered.length, hasEventLink, eventIdStr, awhIdStr });
    return filtered.map((t: any) => {
      // Handle populated references (partID, fromLocationID, toLocationID, relatedActivityWorkHistoryID, relatedActivityWorkHistoryEventID can be objects)
      const partObj = typeof t?.partID === 'object' ? t.partID : null;
      const fromLocObj = typeof t?.fromLocationID === 'object' ? t.fromLocationID : null;
      const toLocObj = typeof t?.toLocationID === 'object' ? t.toLocationID : null;
      const relatedAWHObj = typeof t?.relatedActivityWorkHistoryID === 'object' ? t.relatedActivityWorkHistoryID : null;
      const relatedAWHEObj = typeof t?.relatedActivityWorkHistoryEventID === 'object' ? t.relatedActivityWorkHistoryEventID : null;

      return {
        sfiCode: partObj?.sfiCode || t?.sfiCode || '-',
        partName: partObj?.partName || t?.partName || '-',
        partNumber: partObj?.partNumber || t?.partNumber || '-',
        unit: partObj?.unit || t?.unit || '-',
        quantityUsed: t?.transactionType === 'issue' ? Math.abs(t?.quantity ?? 0) : 0,
        quantityReturned: t?.transactionType === 'return' ? Math.abs(t?.quantity ?? 0) : 0,
        unitCost: typeof t?.unitCost === 'number' ? t.unitCost : undefined,
        totalCost: typeof t?.totalCost === 'number' ? t.totalCost : undefined,
        location: t?.transactionType === 'issue'
          ? (fromLocObj?.locationName || t?.fromLocationName || fromLocObj?.locationCode || '-')
          : (toLocObj?.locationName || t?.toLocationName || toLocObj?.locationCode || fromLocObj?.locationName || t?.fromLocationName || '-'),
        // Additional fields to show full inventory transaction context
        organizationID: t?.organizationID || t?.organization_ID || '-',
        partID: partObj?._id || t?.partID || '-',
        transactionType: t?.transactionType || '-',
        quantity: typeof t?.quantity === 'number' ? t.quantity : undefined,
        fromLocationID: fromLocObj?.locationName || t?.fromLocationName || fromLocObj?._id || t?.fromLocationID || '-',
        toLocationID: toLocObj?.locationName || t?.toLocationName || toLocObj?._id || t?.toLocationID || '-',
        relatedActivityWorkHistoryID: relatedAWHObj?._id || t?.relatedActivityWorkHistoryID || '-',
        relatedActivityWorkHistoryEventID: relatedAWHEObj?._id || t?.relatedActivityWorkHistoryEventID || '-',
        performedBy: (typeof t?.performedBy === 'object' ? (t?.performedBy as any)?.email : t?.performedBy) || '-',
        reason: t?.reason || '-',
        comments: t?.comments || '-',
        documentReferences: Array.isArray(t?.documentReferences) ? t.documentReferences.join(', ') : '-',
        transactionDate: t?.transactionDate || undefined,
        createdAt: t?.createdAt || undefined,
        updatedAt: t?.updatedAt || undefined,
        effectiveTransactionTime: t?.effectiveTransactionTime || undefined,
      };
    });
  }, [awh, row, selectedEventId, ids.awhId]);


  const title = awh?.activityID?.name || row?.activityName || row?.activity_ID || 'Activity Work History';
  const plannedDueDate = awh?.plannedDueDate || row?.plannedDueDate;
  const nextPlanned = awh?.nextPlannedDueDate || awh?.nextDueDate || row?.nextPlannedDueDate || row?.nextDueDate || row?.nextActivityPlannedOn || null;
  const committed = awh?.committed === true || row?.committed === true;
  // Prefer the most recent non-'created' event; otherwise last by timestamp
  const latest = (() => {
    if (!events?.length) return null;
    const reversed = [...events].reverse();
    const notCreated = reversed.find(e => String(e?.activityCompletionStatus || e?.status || '').toLowerCase() !== 'created');
    return notCreated || events[events.length - 1];
  })();
  // Selected event: from selection, else latest
  const selected = (selectedEventId ? events.find(e => e?._id === selectedEventId) : null) || latest;
  const selectedStatus = selected?.activityCompletionStatus || row?.activityCompletionStatus || row?.status;
  const effectivePerformedOn = (
    selected?.performedOn ||
    selected?.createdAt ||
    row?.latestCompletionTimestamp ||
    row?.completionTimestamp ||
    row?.performedOn ||
    null
  );
  const effectivePerformedBy = (
    (typeof selected?.performedBy === 'object' && (selected?.performedBy as any)?.email) ||
    selected?.performedByEmail || selected?.performedByName || selected?.performedBy ||
    row?.performedByEmail || row?.performedByName || row?.performedBy ||
    null
  );


  // Prefer Inventory Transactions (local embedded) -> API fallback -> embedded partsUsed
  const partsList = partsFromTxns.length ? partsFromTxns : (partsFromApi.length ? partsFromApi : ((selected as any)?.partsUsed || []));


  // Fetch forms by AWH ID (self-contained) - ALWAYS fetch to get populated formTemplateID
  useEffect(() => {
    const org = ids.org; const awhId = ids.awhId;
    // console.log('[AWH][FORMS][FETCH] Starting forms fetch', { org, awhId, hasOrg: !!org, hasAwhId: !!awhId });
    if (!org || !awhId) {
      // console.log('[AWH][FORMS][FETCH] Skipping - missing org or awhId');
      setFormsFromApi([]); // Clear API forms when no valid IDs
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/phoenix-cloud/forms/${org}/forms?activityWorkHistoryID=${awhId}&limit=100`;
       // console.log('[AWH][FORMS][FETCH] Calling API:', url);
        const list = await fetchJSONWithLogs(url, 'GET forms by AWH ID');
      //  console.log('[AWH][FORMS][FETCH] Raw API response:', { type: typeof list, isArray: Array.isArray(list), list });

        // Handle both array response and object with forms property
        let arr = [];
        if (Array.isArray(list)) {
          arr = list;
        } else if (list && typeof list === 'object' && Array.isArray(list.forms)) {
     //     console.log('[AWH][FORMS][FETCH] Response is object with forms array');
          arr = list.forms;
        }

     //   console.log('[AWH][FORMS][FETCH] Extracted forms array:', { count: arr.length, forms: arr });

        // Normalize: ensure sourceMeta is present for FormViewerDelegate
        const mapped = arr.map((f:any) => ({
          ...f,
          sourceMeta: f?.sourceMeta || { organizationID: org, entities: { formId: f?._id } },
        }));
     //   console.log('[AWH][FORMS][FETCH] Mapped forms:', { count: mapped.length, mapped });
        if (!cancelled) setFormsFromApi(mapped);
      } catch (e) {
        console.error('[AWH][FORMS][FETCH] Error fetching forms:', e);
        if (!cancelled) setFormsFromApi([]);
      }
    })();
    return () => { cancelled = true; };
  }, [ids.org, ids.awhId]);

  // Auto-expand parts when available and log effective list
  useEffect(() => {
    const embedded = (selected as any)?.partsUsed?.length || 0;
    const local = partsFromTxns.length;

    const api = partsFromApi.length;
    const total = embedded + local + api;
  //  console.log('[AWH][PARTS][EFFECTIVE_LIST]', { embedded, local, api, total, using: embedded ? 'embedded' : (local ? 'local_txns' : (api ? 'api_txns' : 'none')), partsList });
    if (total > 0) setShowParts(true);
  }, [selectedEventId, (selected as any)?.partsUsed?.length, partsFromTxns.length, partsFromApi.length]);

  // Self-contained forms: ALWAYS prefer API forms (properly populated) over embedded forms
  // Embedded forms may not have formTemplateID populated, causing IDs to display instead of names
  const validatedForms = (
    (formsFromApi.length > 0) ? formsFromApi :
    (Array.isArray(awh?.validatedForms) && awh?.validatedForms?.length > 0) ? awh!.validatedForms :
    (Array.isArray(row?.validatedForms) && row?.validatedForms?.length > 0) ? row!.validatedForms :
    []
  ) as any[];

  // console.log('[AWH][FORMS][DISPLAY] Forms source decision:', {
  //   awhFormsCount: Array.isArray(awh?.validatedForms) ? awh.validatedForms.length : 0,
  //   rowFormsCount: Array.isArray(row?.validatedForms) ? row.validatedForms.length : 0,
  //   apiFormsCount: formsFromApi.length,
  //   selectedSource: (formsFromApi.length > 0) ? 'api' :
  //                   (Array.isArray(awh?.validatedForms) && awh?.validatedForms?.length > 0) ? 'awh' :
  //                   (Array.isArray(row?.validatedForms) && row?.validatedForms?.length > 0) ? 'row' : 'none',
  //   finalCount: validatedForms.length,
  //   validatedForms
  // });
  // Compute downtime hours from start/end dates
  const downtimeHours = useMemo(() => {
    if (!awh?.downtimeStartDate || !awh?.downtimeEndDate) return undefined;
    try {
      const start = new Date(awh.downtimeStartDate);
      const end = new Date(awh.downtimeEndDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return undefined;
      const diffMs = end.getTime() - start.getTime();
      return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // Round to 2 decimal places
    } catch {
      return undefined;
    }
  }, [awh?.downtimeStartDate, awh?.downtimeEndDate]);

  // Handler to open form in FormViewerDelegate
  const handleViewForm = useCallback((form: any) => {
    // console.log('WorkHistoryViewerDelegate: handleViewForm:', form);
    const formDoc = {
      _id: form._id,
      name: form.name || form.formTemplateID || 'Form',
      formData: form.formData || {},
      submittedAt: form.submittedAt || form.validatedAt,
      committedAt: form.committedAt || form.validatedAt,
      status: form.status || (form.validated ? 'validated' : (form.rejected ? 'rejected' : 'pending')),
      organizationID: form.sourceMeta?.organizationID || awh?.sourceMeta?.entities?.organizationId || row?.sourceMeta?.entities?.organizationId,
      templateId: form.sourceMeta?.entities?.formTemplateId,
      templateSnapshot: form.templateSnapshot,
      sourceMeta: form.sourceMeta,
    };
    formViewerRef.current?.open(formDoc);
  }, [awh, row]);

  const modal = (
    <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)] h-[72vh] max-h-[80vh] min-h-[60vh] flex flex-col overflow-hidden">
          {/* Header aligned with Cloud FE semantics */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900">{t('aiResults.activity_history','Activity History')}</div>
              <div className="mt-1 flex items-center gap-2 min-w-0">
                <div className="text-xs text-gray-900 truncate font-medium flex-1">{title}</div>
                {(() => {
                  const src: any = row || {};
                  const mach = (src?.machinery_ID || src?.machineryID || src?.machineryName) as string | undefined;
                  const comp = (src?.component_ID || src?.componentID || src?.componentName) as string | undefined;
                  const label = [mach, comp].filter(Boolean).map(v => String(v)).join(' | ');
                  if (!label) return null;
                  return (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-gray-300 text-gray-700 bg-white shrink-0">
                      {label}
                    </span>
                  );
                })()}
              </div>
            </div>


            <div className="flex items-center gap-2">
              {committed && (<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">{t('aiResults.committed','Committed')}</span>)}
              {selectedStatus && (<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${statusChipClass(selectedStatus)}`}>{String(selectedStatus)}</span>)}
              <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close} aria-label="Close">{t('aiResults.close','Close')}</button>
            </div>
          </div>

          <div className="p-4 space-y-6 overflow-y-auto flex-1">
            {/* Compact summary row */}
            <section className="rounded-md border border-[rgba(202,206,214,0.5)] p-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-900">
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-gray-600">{t('aiResults.planned_due_date','Planned Due Date')}:</span>
                  <span>{plannedDueDate ? formatDate(plannedDueDate) : '-'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-gray-600">{t('aiResults.next_activity_planned_on','Next Activity Planned on')}:</span>
                  <span>{nextPlanned ? formatDate(nextPlanned) : '-'}</span>
                </div>
              </div>
            </section>

            {/* Failure Tracking Section - Only show if this is a failure event */}
            {awh?.isFailureEvent && (
              <section className="rounded-md border border-red-200 bg-red-50">
                <div className="px-3 py-2 border-b border-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-700" />
                  <span className="text-sm font-semibold text-red-900">{t('aiResults.failure_tracking', 'Failure Tracking')}</span>
                </div>
                <div className="p-3 space-y-3">
                  {/* First row: Severity, Downtime, Unplanned flag */}
                  <div className="flex flex-wrap gap-4">
                    {awh.failureSeverity && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{t('aiResults.failure_severity', 'Failure Severity')}:</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getSeverityChipClass(awh.failureSeverity)}`}>
                          {capitalizeFirst(awh.failureSeverity)}
                        </span>
                      </div>
                    )}
                    {awh.isUnplannedMaintenance && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{t('aiResults.unplanned_maintenance', 'Unplanned Maintenance')}:</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-800 border border-orange-300">
                          {t('aiResults.yes', 'Yes')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Second row: Failure Cause */}
                  {awh.failureCause && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1">{t('aiResults.failure_cause', 'Failure Cause')}:</div>
                      <div className="text-xs text-gray-800">{awh.failureCause}</div>
                    </div>
                  )}

                  {/* Third row: Follow-up */}
                  {awh.requiresFollowUp && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{t('aiResults.requires_followup', 'Requires Follow-up')}:</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 border border-amber-300">
                        {t('aiResults.yes', 'Yes')}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Downtime Tracking Section - Only show if this activity had downtime */}
            {awh?.hasDowntime && (
              <section className="rounded-md border border-amber-200 bg-amber-50">
                <div className="px-3 py-2 border-b border-amber-200 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-700" />
                  <span className="text-sm font-semibold text-amber-900">{t('aiResults.downtime_tracking', 'Downtime Tracking')}</span>
                </div>
                <div className="p-3 space-y-3">
                  {/* First row: Start Date, End Date, Downtime Hours */}
                  <div className="flex flex-wrap gap-4">
                    {awh.downtimeStartDate && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{t('aiResults.downtime_start', 'Start')}:</span>
                        <span className="text-xs text-gray-800">{formatDateTime(awh.downtimeStartDate)}</span>
                      </div>
                    )}
                    {awh.downtimeEndDate && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{t('aiResults.downtime_end', 'End')}:</span>
                        <span className="text-xs text-gray-800">{formatDateTime(awh.downtimeEndDate)}</span>
                      </div>
                    )}
                    {downtimeHours !== undefined && downtimeHours > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{t('aiResults.downtime_hours', 'Duration (Hours)')}:</span>
                        <span className="text-xs font-semibold text-red-700">{downtimeHours}</span>
                      </div>
                    )}
                  </div>

                  {/* Second row: Description */}
                  {awh.downtimeDescription && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1">{t('aiResults.downtime_description', 'Reason/Description')}:</div>
                      <div className="text-xs text-gray-800 whitespace-pre-wrap">{awh.downtimeDescription}</div>
                    </div>
                  )}

                  {/* Third row: Operational Impact */}
                  {awh.operationalImpact && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{t('aiResults.operational_impact', 'Operational Impact')}:</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getSeverityChipClass(awh.operationalImpact)}`}>
                        {capitalizeFirst(awh.operationalImpact)}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Events list (full width) */}
            {events?.length > 0 && (
              <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900 flex items-center justify-between">
                  <span>{t('aiResults.events','Events')}</span>
                  <span className="text-[11px] text-gray-500 font-normal">{t('aiResults.events_click_hint','Click an event to view details and parts')}</span>
                </div>
                <div className="max-h-40 overflow-auto divide-y divide-[rgba(202,206,214,0.5)]">
                  {events.map((e: any, idx: number) => {
                    const isObj = e && typeof e === 'object';
                    const isSel = (isObj ? e?._id : null) === selectedEventId;
                    // Derive fields for both object and string events
                    let status: any = isObj ? (e?.activityCompletionStatus || e?.status) : undefined;
                    let desc: string = isObj ? (e?.description || '-') : String(e || '-');
                    let when: any = isObj ? (e?.performedOn || e?.createdAt || null) : null;
                    if (!isObj && typeof e === 'string') {
                      const m = e.match(/^\s*([^:]+):\s*(.*)$/);
                      if (m) { status = m[1]; desc = m[2]; }
                    }
                    const key = (isObj && e?._id) || (when ? String(new Date(when).getTime()) : `idx-${idx}`);
                    return (
                      <button
                        key={key}
                        className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between ${isSel ? 'bg-blue-50' : 'hover:bg-gray-50'} cursor-pointer`}
                        onClick={() => setSelectedEventId(isObj ? (e?._id || null) : null)}
                      >
                        <span className="truncate">
                          <span className="text-gray-900 mr-2">{when ? formatDate(when) : '-'}</span>
                          <span className="text-gray-600">{desc || '-'}</span>
                        </span>
                        {status && (
                          <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${statusChipClass(status)}`}>{String(status)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Event Details */}
            <section className="rounded-md border border-[rgba(202,206,214,0.3)]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(202,206,214,0.5)]">
                <div className="text-sm font-semibold text-gray-900">{t('aiResults.event_details','Event Details')}</div>
                {selectedStatus && (<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${statusChipClass(selectedStatus)}`}>{String(selectedStatus)}</span>)}
              </div>
              <div className="p-3 text-xs text-gray-800 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
                <div className="md:col-span-3">
                  <div className="text-gray-500">{t('aiResults.description','Description')}</div>
                  <div>{selected?.description || row?.activityDescription || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">{t('aiResults.maintenance_type','Maintenance Type')}</div>
                  <div>{selected?.maintenanceType || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">{t('aiResults.performed_on','Performed On')}</div>
                  <div>{effectivePerformedOn ? formatDate(effectivePerformedOn) : '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">{t('aiResults.performed_by','Performed By')}</div>
                  <div>{effectivePerformedBy || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">{t('aiResults.created_at','Created At')}</div>
                  <div>{selected?.createdAt ? formatDate(selected.createdAt) : '-'}</div>
                </div>
              </div>
            </section>

            {/* Documents */}
            <section className="rounded-md border border-[rgba(202,206,214,0.3)]">
              <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">{t('aiResults.documents_title','Documents')}</div>
              <div className="p-3">
                {docsLoading ? (
                  <div className="text-xs text-gray-500">Loading…</div>
                ) : (documents?.length ? (
                  <ul className="text-xs text-blue-700 list-disc pl-5">
                    {documents.map((doc: any, idx: number) => {
                      const isObj = doc && typeof doc === 'object';
                      const name = isObj ? (doc.name || doc.filename || doc.fileName || doc.originalName || doc.documentName || doc.url || `document-${idx}`) : String(doc);
                      const key = `${name}-${idx}`;
                      const handleClick = () => {
                        if (!ids.org || !selectedEventId) return;
                        if (isObj && doc.url && !name) {
                          window.open(String(doc.url), '_blank');
                        } else {
                          downloadEventDocument(ids.org, selectedEventId, String(name));
                        }
                      };
                      return (
                        <li key={key}>
                          <button className="underline hover:text-blue-900" onClick={handleClick}>
                            {t('aiResults.download','Download')}: {String(name)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">{t('aiResults.no_documents_attached','No documents attached')}</div>
                ))}
              </div>
            </section>

            {/* Forms */}
            {validatedForms && validatedForms.length > 0 ? (
              <section className="rounded-md border border-[rgba(202,206,214,0.3)]">
                <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.3)]">
                  <span className="text-sm font-semibold text-gray-900">
                    Forms ({validatedForms.length})
                  </span>
                </div>
                <div className="divide-y divide-[rgba(202,206,214,0.3)]">
                  {validatedForms.map((form: any, idx: number) => {
                    // console.log(`[AWH][FORMS][DISPLAY] Form ${idx}:`, {
                    //   _id: form._id,
                    //   name: form.name,
                    //   formTemplateID: form.formTemplateID,
                    //   formTemplateIDType: typeof form.formTemplateID,
                    //   formTemplateIDName: typeof form.formTemplateID === 'object' ? form.formTemplateID?.name : null,
                    //   committedAt: form.committedAt,
                    //   validatedAt: form.validatedAt,
                    //   submittedAt: form.submittedAt,
                    //   status: form.status,
                    //   fullForm: form
                    // });
                    const formName = form.name ||
                                    (typeof form.formTemplateID === 'object' ? form.formTemplateID?.name : null) ||
                                    form.formTemplateID ||
                                    'Form';
                    const committedDate = form.committedAt || form.validatedAt || form.submittedAt;
                    // console.log(`[AWH][FORMS][DISPLAY] Form ${idx} computed:`, { formName, committedDate });
                    return (
                    <div key={idx} className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {formName}
                          </div>
                          {committedDate && (
                            <div className="text-xs text-gray-500 mt-1">
                              Committed: {formatDateTime(committedDate)}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleViewForm(form)}
                      >
                        View Form
                      </button>
                    </div>
                  );
                  })}
                </div>
              </section>
            ) : (
              <section className="rounded-md border border-[rgba(202,206,214,0.3)] p-3 text-xs text-gray-700">
                {t('aiResults.forms_note_no_forms_required','No forms are required for this activity status.')}
              </section>
            )}

            {/* Parts usage (collapsible) */}
            {partsList && partsList.length > 0 && (
              <section className="rounded-md border border-gray-100">
                <button className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => setShowParts(s => !s)}>
                  <span className="text-sm font-semibold text-gray-900">
                    {t('aiResults.event_parts_usage_details','Event Parts Usage Details')} ({partsList.length} {t('aiResults.items','items')})
                  </span>
                  <span className="text-xs text-gray-500">{showParts ? '▾' : '▸'}</span>
                </button>
                {showParts && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="text-gray-600 bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left">SFI Code</th>
                          <th className="px-3 py-2 text-left">Part Name</th>
                          <th className="px-3 py-2 text-left">Part Number</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                          <th className="px-3 py-2 text-right">Quantity Used</th>
                          <th className="px-3 py-2 text-right">Quantity Returned</th>
                          <th className="px-3 py-2 text-right">Net Quantity</th>
                          <th className="px-3 py-2 text-right">Unit Cost</th>
                          <th className="px-3 py-2 text-right">Total Cost</th>
                          <th className="px-3 py-2 text-left">Location</th>
                          <th className="px-3 py-2 text-left">Organization</th>
                          <th className="px-3 py-2 text-left">Part ID</th>
                          <th className="px-3 py-2 text-left">Transaction Type</th>
                          <th className="px-3 py-2 text-right">Quantity (raw)</th>
                          <th className="px-3 py-2 text-left">From Location</th>
                          <th className="px-3 py-2 text-left">To Location</th>
                          <th className="px-3 py-2 text-left">AWH ID</th>
                          <th className="px-3 py-2 text-left">Event ID</th>
                          <th className="px-3 py-2 text-left">Performed By</th>
                          <th className="px-3 py-2 text-left">Reason</th>
                          <th className="px-3 py-2 text-left">Comments</th>
                          <th className="px-3 py-2 text-left">Transaction Date</th>
                          <th className="px-3 py-2 text-left">Created At</th>
                          <th className="px-3 py-2 text-left">Updated At</th>
                          <th className="px-3 py-2 text-left">Effective Txn Time</th>
                          <th className="px-3 py-2 text-left">Documents</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partsList.map((p: any, idx: number) => (
                          <tr key={idx} className="border-t">
                            <td className="px-3 py-2">{p?.sfiCode || '-'}</td>
                            <td className="px-3 py-2">{p?.partName || '-'}</td>
                            <td className="px-3 py-2">{p?.partNumber || '-'}</td>
                            <td className="px-3 py-2">{p?.unit || '-'}</td>
                            <td className="px-3 py-2 text-right">{p?.quantityUsed ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{p?.quantityReturned ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{typeof p?.quantityUsed==='number'&&typeof p?.quantityReturned==='number' ? (p.quantityUsed - p.quantityReturned) : '-'}</td>
                            <td className="px-3 py-2 text-right">{p?.unitCost ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{p?.totalCost ?? '-'}</td>
                            <td className="px-3 py-2">{p?.location || '-'}</td>
                            <td className="px-3 py-2">{p?.organizationID || '-'}</td>
                            <td className="px-3 py-2">{p?.partID || '-'}</td>
                            <td className="px-3 py-2">{p?.transactionType || '-'}</td>
                            <td className="px-3 py-2 text-right">{p?.quantity ?? '-'}</td>
                            <td className="px-3 py-2">{p?.fromLocationID || '-'}</td>
                            <td className="px-3 py-2">{p?.toLocationID || '-'}</td>
                            <td className="px-3 py-2 text-[11px]">{p?.relatedActivityWorkHistoryID || '-'}</td>
                            <td className="px-3 py-2 text-[11px]">{p?.relatedActivityWorkHistoryEventID || '-'}</td>
                            <td className="px-3 py-2">{p?.performedBy || '-'}</td>
                            <td className="px-3 py-2">{p?.reason || '-'}</td>
                            <td className="px-3 py-2">{p?.comments || '-'}</td>
                            <td className="px-3 py-2">{p?.transactionDate ? formatDateTime(p.transactionDate) : '-'}</td>
                            <td className="px-3 py-2">{p?.createdAt ? formatDateTime(p.createdAt) : '-'}</td>
                            <td className="px-3 py-2">{p?.updatedAt ? formatDateTime(p.updatedAt) : '-'}</td>
                            <td className="px-3 py-2">{p?.effectiveTransactionTime ? formatDateTime(p.effectiveTransactionTime) : '-'}</td>
                            <td className="px-3 py-2">{p?.documentReferences || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
      <FormViewerDelegate ref={formViewerRef} />
    </div>
  );

  return open ? createPortal(modal, document.body) : null;
});

