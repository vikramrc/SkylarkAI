import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import WorkHistoryViewerDelegate, { type WorkHistoryViewerHandle } from '../work-history/WorkHistoryViewerDelegate';
import PurchaseOrderViewerDelegate, { type PurchaseOrderViewerHandle } from '../orders/PurchaseOrderViewerDelegate';
import ReplenishOrderViewerDelegate, { type ReplenishOrderViewerHandle } from '../orders/ReplenishOrderViewerDelegate';

export type InventoryTransactionViewerHandle = {
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

function formatCurrency(v?: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return `$${v.toFixed(2)}`;
}

function transactionTypeChipClass(type?: string) {
  const k = String(type || '').toLowerCase();
  if (k === 'receipt') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (k === 'issue') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (k === 'transfer') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (k === 'return') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export default forwardRef<InventoryTransactionViewerHandle, { initialOpen?: boolean }>(
  function InventoryTransactionViewerDelegate({ initialOpen }, ref) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<boolean>(!!initialOpen);
    const [row, setRow] = useState<any | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [txn, setTxn] = useState<any | null>(null);
    const lastActive = useRef<HTMLElement | null>(null);
    const awhViewerRef = useRef<WorkHistoryViewerHandle>(null);
    const poViewerRef = useRef<PurchaseOrderViewerHandle>(null);
    const roViewerRef = useRef<ReplenishOrderViewerHandle>(null);

    function isLikelyObjectId(v: any): boolean {
      return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
    }

    // ID resolution
    const ids = useMemo(() => {
      const src = row || {};
      const org = src?.sourceMeta?.organizationID || src?.organizationID || src?.organization_ID;
      const txnIdRaw = src?.sourceMeta?.entities?.inventoryTransactionId || src?._id;
      const txnId = isLikelyObjectId(txnIdRaw) ? txnIdRaw : undefined;
      return { org, txnId };
    }, [row]);

    // Close handler
    const close = useCallback(() => {
      setOpen(false);
      setTimeout(() => lastActive.current?.focus?.(), 0);
    }, []);

    // Open handler
    const openWith = useCallback((r?: any | null) => {
      lastActive.current = document.activeElement as HTMLElement;
      setRow(r || null);
      setOpen(true);
    }, []);

    // Imperative handle
    useImperativeHandle(ref, () => ({ open: openWith, close }), [openWith, close]);

    // ESC key handler
    useEffect(() => {
      function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
      if (open) document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, close]);

    // Data fetching effect
    useEffect(() => {
      if (!open) return;

      (async () => {
        setLoading(true);
        try {
          // Try to fetch complete transaction data using transactionID from sourceMeta
          const txnId = row?.sourceMeta?.entities?.inventoryTransactionId || row?._id;
          const orgId = row?.sourceMeta?.organizationID || ids.org;

          if (txnId && orgId) {
          //  console.log('[TXN] Fetching transaction:', txnId, 'for org:', orgId);
            const url = `/api/phoenix-cloud/inventory/${orgId}/transactions?transactionID=${txnId}`;
            const resp = await fetch(url);

            if (resp.ok) {
              const json = await resp.json();
              // The endpoint returns an array, take the first item
              if (Array.isArray(json) && json.length > 0) {
         //       console.log('[TXN] Fetched transaction data:', json[0]);
                setTxn(json[0]);
              } else {
                console.warn('[TXN] No transaction found, using row data');
                setTxn(row);
              }
            } else {
              console.warn('[TXN] Failed to fetch transaction, using row data');
              setTxn(row);
            }
          } else {
            console.warn('[TXN] Missing transaction ID or org ID, using row data');
            setTxn(row);
          }
        } catch (e) {
          console.warn('[TXN] Error fetching transaction:', e);
          setTxn(row);
        } finally {
          setLoading(false);
        }
      })();
    }, [open, row, ids.org]);

    // Extract fields with comprehensive fallback logic
    const data = txn || row || {};

    // Transaction type
    const transactionType = data?.transactionType || '-';

    // Part information - handle both populated and unpopulated references
    const partObj = typeof data?.partID === 'object' ? data.partID : null;
    const partName = partObj?.partName || data?.partName || data?.part_ID?.partName || '-';
    const partNumber = partObj?.partNumber || data?.partNumber || data?.part_ID?.partNumber || '-';
    const partDescription = partObj?.description || data?.partDescription || data?.part_ID?.description || '';
    const unit = partObj?.unit || data?.unit || data?.part_ID?.unit || 'units';

    // Quantity
    const quantity = typeof data?.quantity === 'number' ? data.quantity : 0;

    // Location information - handle both populated and unpopulated references
    const fromLocationObj = typeof data?.fromLocationID === 'object' ? data.fromLocationID : null;
    const toLocationObj = typeof data?.toLocationID === 'object' ? data.toLocationID : null;

    const fromLocationName = fromLocationObj?.locationName || data?.fromLocationName || data?.fromLocation_ID?.locationName || '';
    const fromLocationCode = fromLocationObj?.locationCode || data?.fromLocationCode || data?.fromLocation_ID?.locationCode || '';
    const fromLocation = fromLocationName || fromLocationCode || (typeof data?.fromLocationID === 'string' && data.fromLocationID !== '-' ? data.fromLocationID : '-');

    const toLocationName = toLocationObj?.locationName || data?.toLocationName || data?.toLocation_ID?.locationName || '';
    const toLocationCode = toLocationObj?.locationCode || data?.toLocationCode || data?.toLocation_ID?.locationCode || '';
    const toLocation = toLocationName || toLocationCode || (typeof data?.toLocationID === 'string' && data.toLocationID !== '-' ? data.toLocationID : '-');

    // Dates
    const transactionDate = data?.transactionDate || data?.createdAt;

    // User information
    const performedByObj = typeof data?.performedBy === 'object' ? data.performedBy : null;
    const performedBy = performedByObj?.email || performedByObj?.name || data?.performedByEmail || data?.performedByName || (typeof data?.performedBy === 'string' && data.performedBy !== '-' ? data.performedBy : '-');

    const authorizedByObj = typeof data?.authorizedBy === 'object' ? data.authorizedBy : null;
    const authorizedBy = authorizedByObj?.email || authorizedByObj?.name || data?.authorizedByEmail || data?.authorizedByName || (typeof data?.authorizedBy === 'string' && data.authorizedBy !== '-' ? data.authorizedBy : '-');

    // Cost information
    const unitCost = typeof data?.unitCost === 'number' ? data.unitCost : undefined;
    const totalCost = typeof data?.totalCost === 'number' ? data.totalCost : undefined;

    // Additional information
    const reason = data?.reason || '-';
    const comments = data?.comments || '-';

    // Related entities - handle both populated objects and string IDs
    const relatedAWH = data?.relatedActivityWorkHistoryID;

    // Extract event ID - can be a string or populated object
    let relatedEvent = data?.relatedActivityWorkHistoryEventID;
    if (relatedEvent && typeof relatedEvent === 'object' && relatedEvent._id) {
      relatedEvent = relatedEvent._id;
    }

    const relatedPO = data?.relatedPurchaseOrderID;
    const relatedRO = data?.relatedReplenishOrderID;

    // System information
    const txnId = data?._id || '-';
    const createdAt = data?.createdAt;
    const updatedAt = data?.updatedAt;
    const effectiveTimestamp = data?.effectiveTimestamp;

    const title = `${String(transactionType).charAt(0).toUpperCase()}${String(transactionType).slice(1)} · ${partName}`;

    // Render portal
    return open ? createPortal(
      <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
        <div className="absolute inset-0 bg-black/40" onClick={close} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)] h-[72vh] max-h-[80vh] min-h-[60vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{t('aiResults.inventory_transaction', 'Inventory Transaction')}</div>
                <div className="mt-1 text-xs text-gray-900 truncate font-medium">{title}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${transactionTypeChipClass(transactionType)}`}>
                  {String(transactionType)}
                </span>
                <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close} aria-label="Close">
                  {t('aiResults.close', 'Close')}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6 overflow-y-auto flex-1">
              {loading ? (
                <div className="text-sm text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* Transaction Summary */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.transaction_summary', 'Transaction Summary')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 space-y-3">
                      {/* Part Information */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        <div className="md:col-span-2">
                          <div className="text-gray-500">{t('aiResults.part', 'Part')}</div>
                          <div className="font-medium">{partName}</div>
                          {partNumber !== '-' && (
                            <div className="text-gray-600 mt-0.5">Part #: {partNumber}</div>
                          )}
                          {partDescription && (
                            <div className="text-gray-600 mt-0.5 text-[11px]">{partDescription}</div>
                          )}
                        </div>
                      </div>

                      {/* Transaction Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 pt-2 border-t border-[rgba(202,206,214,0.3)]">
                        <div>
                          <div className="text-gray-500">{t('aiResults.transaction_type', 'Transaction Type')}</div>
                          <div className="capitalize font-medium">{transactionType}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.quantity', 'Quantity')}</div>
                          <div className="font-medium">{quantity} {unit}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.from_location', 'From Location')}</div>
                          <div>{fromLocation}</div>
                          {fromLocationCode && fromLocationName && (
                            <div className="text-gray-600 text-[11px] mt-0.5">Code: {fromLocationCode}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.to_location', 'To Location')}</div>
                          <div>{toLocation}</div>
                          {toLocationCode && toLocationName && (
                            <div className="text-gray-600 text-[11px] mt-0.5">Code: {toLocationCode}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.transaction_date', 'Transaction Date')}</div>
                          <div>{transactionDate ? formatDateTime(transactionDate) : '-'}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.performed_by', 'Performed By')}</div>
                          <div>{performedBy}</div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Cost Details */}
                  {(unitCost !== undefined || totalCost !== undefined) && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                        {t('aiResults.cost_details', 'Cost Details')}
                      </div>
                      <div className="p-3 text-xs text-gray-800 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        <div>
                          <div className="text-gray-500">{t('aiResults.unit_cost', 'Unit Cost')}</div>
                          <div>{formatCurrency(unitCost)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">{t('aiResults.total_cost', 'Total Cost')}</div>
                          <div>{formatCurrency(totalCost)}</div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Related Entities */}
                  {(relatedAWH || relatedPO || relatedRO) && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                        {t('aiResults.related_entities', 'Related Entities')}
                      </div>
                      <div className="p-3 text-xs text-gray-800 space-y-3">
                        {relatedAWH && (
                          <div>
                            <div className="text-gray-500">{t('aiResults.activity_work_history', 'Activity Work History')}</div>
                            <div className="font-medium">{typeof relatedAWH === 'object' ? (relatedAWH?.activityID?.description || relatedAWH?.activityName || 'Work History') : 'Work History'}</div>
                            {relatedEvent && (
                              <div className="text-gray-600 text-[11px] mt-0.5">
                                Event: {typeof relatedEvent === 'object' ? (relatedEvent?.description || 'Event') : 'Event'}
                              </div>
                            )}
                            <div className="pt-1">
                              <button
                                className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                onClick={() => {
                                  // Build minimal sourceMeta for AWH using fetched txn when original row lacks IDs
                                  const sm = (row?.sourceMeta || data?.sourceMeta) || {};
                                  const awhIdFromData = typeof relatedAWH === 'object' ? relatedAWH?._id : relatedAWH;
                                  const evIdFromDataRaw = data?.relatedActivityWorkHistoryEventID;
                                  const evIdFromData = (evIdFromDataRaw && typeof evIdFromDataRaw === 'object' && evIdFromDataRaw._id) ? evIdFromDataRaw._id : evIdFromDataRaw;
                                  const awhRow = {
                                    sourceMeta: {
                                      organizationID: sm?.organizationID || ids.org,
                                      entities: {
                                        activityWorkHistoryId: sm?.entities?.activityWorkHistoryId || awhIdFromData,
                                        activityWorkHistoryEventId: sm?.entities?.activityWorkHistoryEventId || evIdFromData,
                                      }
                                    }
                                  };
                               //   console.log('[TXN→AWH] Opening AWH (constructed sourceMeta):', awhRow);
                                  awhViewerRef.current?.open(awhRow);
                                }}
                              >
                                {t('aiResults.view_awh', 'View AWH')}
                              </button>
                            </div>
                          </div>
                        )}
                        {relatedPO && (
                          <div className="pt-2 border-t border-[rgba(202,206,214,0.3)]">
                            <div className="text-gray-500">{t('aiResults.purchase_order', 'Purchase Order')}</div>
                            <div className="font-medium">{typeof relatedPO === 'object' ? (relatedPO?.orderNumber || 'PO') : String(relatedPO).substring(0, 8) + '...'}</div>
                            <div className="pt-1">
                              <button
                                className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                onClick={() => {
                                  // Build minimal sourceMeta for PO using canonical key
                                  const sm = row?.sourceMeta || {};
                                  const poIdFromData = typeof relatedPO === 'object' ? relatedPO?._id : relatedPO;
                                  const poRow = {
                                    sourceMeta: {
                                      organizationID: sm?.organizationID || ids.org,
                                      entities: {
                                        purchaseOrderId: poIdFromData,
                                      }
                                    }
                                  };
                                  poViewerRef.current?.open(poRow);
                                }}
                              >
                                {t('aiResults.view_purchase_order', 'View Purchase Order')}
                              </button>
                            </div>
                          </div>
                        )}
                        {relatedRO && (
                          <div className="pt-2 border-t border-[rgba(202,206,214,0.3)]">
                            <div className="text-gray-500">{t('aiResults.replenish_order', 'Replenish Order')}</div>
                            <div className="font-medium">{typeof relatedRO === 'object' ? (relatedRO?.orderNumber || 'RO') : String(relatedRO).substring(0, 8) + '...'}</div>
                            <div className="pt-1">
                              <button
                                className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                onClick={() => {
                                  // Build minimal sourceMeta for RO using canonical key
                                  const sm = row?.sourceMeta || {};
                                  const roIdFromData = typeof relatedRO === 'object' ? relatedRO?._id : relatedRO;
                                  const roRow = {
                                    sourceMeta: {
                                      organizationID: sm?.organizationID || ids.org,
                                      entities: {
                                        replenishOrderId: roIdFromData,
                                      }
                                    }
                                  };
                                  roViewerRef.current?.open(roRow);
                                }}
                              >
                                {t('aiResults.view_replenish_order', 'View Replenish Order')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Additional Information */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.additional_information', 'Additional Information')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 space-y-2">
                      {reason && reason !== '-' && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.reason', 'Reason')}</div>
                          <div>{reason}</div>
                        </div>
                      )}
                      {comments && comments !== '-' && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.comments', 'Comments')}</div>
                          <div>{comments}</div>
                        </div>
                      )}
                      {authorizedBy && authorizedBy !== '-' && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.authorized_by', 'Authorized By')}</div>
                          <div>{authorizedBy}</div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* System Information */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.system_information', 'System Information')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                      <div>
                        <div className="text-gray-500">{t('aiResults.transaction_id', 'Transaction ID')}</div>
                        <div className="font-mono text-[10px]">{txnId}</div>
                      </div>
                      {effectiveTimestamp && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.effective_timestamp', 'Effective Timestamp')}</div>
                          <div>{formatDateTime(effectiveTimestamp)}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500">{t('aiResults.created_at', 'Created At')}</div>
                        <div>{createdAt ? formatDateTime(createdAt) : '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.updated_at', 'Updated At')}</div>
                        <div>{updatedAt ? formatDateTime(updatedAt) : '-'}</div>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
        <WorkHistoryViewerDelegate ref={awhViewerRef} />
        <PurchaseOrderViewerDelegate ref={poViewerRef} />
        <ReplenishOrderViewerDelegate ref={roViewerRef} />
      </div>,
      document.body
    ) : null;
  }
);

