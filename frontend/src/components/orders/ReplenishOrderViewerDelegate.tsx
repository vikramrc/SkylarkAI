import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ReplenishOrderViewerHandle = {
  open: (row?: any | null) => void;
  close: () => void;
};

function isLikelyObjectId(v: any): boolean {
  return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
}

export default forwardRef<ReplenishOrderViewerHandle, { initialOpen?: boolean }>(
  function ReplenishOrderViewerDelegate({ initialOpen }, ref) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<boolean>(!!initialOpen);
    const [row, setRow] = useState<any | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [order, setOrder] = useState<any | null>(null);
    const [documents, setDocuments] = useState<any[]>([]);
    const lastActive = useRef<HTMLElement | null>(null);

    const ids = useMemo(() => {
      const src = row || {};
      const org = src?.sourceMeta?.organizationID;
      const rid = src?.sourceMeta?.entities?.replenishOrderId;
      return { org, rid: isLikelyObjectId(rid) ? rid : undefined };
    }, [row]);

    const close = useCallback(() => {
      setOpen(false);
      setTimeout(() => lastActive.current?.focus?.(), 0);
    }, []);

    const openWith = useCallback((r?: any | null) => {
      lastActive.current = document.activeElement as HTMLElement;
      setRow(r || null);
      setOpen(true);
    }, []);

    useImperativeHandle(ref, () => ({ open: openWith, close }), [openWith, close]);

    useEffect(() => {
      function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
      if (open) document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, close]);

    useEffect(() => {
      if (!open) return;
      (async () => {
        setLoading(true);
        try {
          if (ids.org && ids.rid) {
            const [orderResp, docsResp] = await Promise.allSettled([
              fetch(`/api/phoenix-cloud/inventory/${ids.org}/replenish-orders/${ids.rid}`),
              fetch(`/api/phoenix-cloud/inventory/${ids.org}/replenish-orders/${ids.rid}/documents`),
            ]);
            if (orderResp.status === 'fulfilled' && orderResp.value.ok) {
              setOrder(await orderResp.value.json());
            } else {
              setOrder(row);
            }
            if (docsResp.status === 'fulfilled' && docsResp.value.ok) {
              const list = await docsResp.value.json();
              setDocuments(Array.isArray(list) ? list : []);
            } else {
              setDocuments([]);
            }
          } else {
            setOrder(row);
            setDocuments([]);
          }
        } catch (e) {
          console.warn('[RO][ERR]', e);
          setOrder(row);
          setDocuments([]);
        } finally {
          setLoading(false);
        }
      })();
    }, [open, ids.org, ids.rid, row]);

    const data = order || row || {};
    const title = data?.orderNumber || data?.title || t('aiResults.replenish_order', 'Replenish Order');

    async function download(org: string, rid: string, name: string) {
      try {
        const url = `/api/phoenix-cloud/inventory/${org}/replenish-orders/${rid}/download/${encodeURIComponent(name)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.warn('[RO][DOWNLOAD_ERR]', e);
        alert('Failed to download file');
      }
    }

    return open ? createPortal(
      <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
        <div className="absolute inset-0 bg-black/40" onClick={close} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)] h-[72vh] max-h-[80vh] min-h-[60vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{t('aiResults.replenish_order', 'Replenish Order')}</div>
                <div className="mt-1 text-xs text-gray-900 truncate font-medium">{title}</div>
              </div>
              <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close}>{t('aiResults.close', 'Close')}</button>
            </div>
            <div className="p-4 space-y-6 overflow-y-auto flex-1">
              {loading ? (
                <div className="text-sm text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* Order Details Section */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.order_details', 'Order Details')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 grid grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <div className="text-gray-500">{t('aiResults.order_number', 'Order Number')}</div>
                        <div className="font-medium">{data?.orderNumber || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.status', 'Status')}</div>
                        <div className="font-medium capitalize">{data?.status?.replace(/_/g, ' ') || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.part_number', 'Part Number')}</div>
                        <div className="font-medium">{data?.itemID?.partNumber || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.part_name', 'Part Name')}</div>
                        <div className="font-medium">{data?.itemID?.partName || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.vessel', 'Vessel')}</div>
                        <div className="font-medium">{data?.vesselID?.vesselName || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.location', 'Location')}</div>
                        <div className="font-medium">{data?.toLocationID?.locationName || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.requested_quantity', 'Requested Quantity')}</div>
                        <div className="font-medium">{data?.requestedQuantity || 0} {data?.itemID?.unit || ''}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.received_quantity', 'Received Quantity')}</div>
                        <div className="font-medium">{data?.receivedQuantity || 0} {data?.itemID?.unit || ''}</div>
                      </div>
                      {data?.completionPercentage !== undefined && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.completion', 'Completion')}</div>
                          <div className="font-medium">{data.completionPercentage}%</div>
                        </div>
                      )}
                      {data?.requestedBy && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.requested_by', 'Requested By')}</div>
                          <div className="font-medium">{data.requestedBy?.email || '-'}</div>
                        </div>
                      )}
                      {data?.remarks && (
                        <div className="col-span-2">
                          <div className="text-gray-500">{t('aiResults.remarks', 'Remarks')}</div>
                          <div className="font-medium">{data.remarks}</div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Document References Section */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.document_references', 'Document References')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 space-y-2">
                      {documents.length === 0 && (
                        <div className="text-gray-500">{t('aiResults.no_documents_attached', 'No documents attached')}</div>
                      )}
                      {documents.map((d, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 border-b last:border-b-0 border-[rgba(202,206,214,0.5)] py-1">
                          <div className="truncate">
                            <div className="font-medium text-gray-900 truncate" title={d?.name || d?.fileName || ''}>{d?.name || d?.fileName || '-'}</div>
                            {d?.contentType && <div className="text-[11px] text-gray-600">{d.contentType}</div>}
                          </div>
                          {ids.org && ids.rid && (d?.name || d?.fileName) && (
                            <button
                              className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => download(ids.org!, ids.rid!, d?.name || d?.documentName || d?.fileName)}
                            >
                              {t('aiResults.download', 'Download')}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    ) : null;
  }
);

