import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type PurchaseOrderViewerHandle = {
  open: (row?: any | null) => void;
  close: () => void;
};

function isLikelyObjectId(v: any): boolean {
  return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
}

export default forwardRef<PurchaseOrderViewerHandle, { initialOpen?: boolean }>(
  function PurchaseOrderViewerDelegate({ initialOpen }, ref) {
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
      const pid = src?.sourceMeta?.entities?.purchaseOrderId;
      return { org, pid: isLikelyObjectId(pid) ? pid : undefined };
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
          if (ids.org && ids.pid) {
            const [orderResp, docsResp] = await Promise.allSettled([
              fetch(`/api/phoenix-cloud/inventory/${ids.org}/purchase-order/${ids.pid}`),
              fetch(`/api/phoenix-cloud/inventory/${ids.org}/purchase-order/${ids.pid}/documents`)
            ]);

            if (orderResp.status === 'fulfilled' && orderResp.value.ok) {
              const orderData = await orderResp.value.json();
              setOrder(orderData);
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
          console.warn('[PO][ERR]', e);
          setOrder(row);
          setDocuments([]);
        } finally {
          setLoading(false);
        }
      })();
    }, [open, ids.org, ids.pid, row]);

    const data = order || row || {};
    const poTitle = data?.poNumber || data?.orderNumber || data?.title || t('aiResults.purchase_order', 'Purchase Order');

    async function download(org: string, pid: string, name: string) {
      try {
        const url = `/api/phoenix-cloud/inventory/${org}/purchase-order/${pid}/download/${encodeURIComponent(name)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.warn('[PO][DOWNLOAD_ERR]', e);
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
                <div className="text-sm font-semibold text-gray-900">{t('aiResults.purchase_order', 'Purchase Order')}</div>
                <div className="mt-1 text-xs text-gray-900 truncate font-medium">{poTitle}</div>
              </div>
              <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close}>{t('aiResults.close', 'Close')}</button>
            </div>
            <div className="p-4 space-y-6 overflow-y-auto flex-1">
              {loading ? (
                <div className="text-sm text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* Order Header Section */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.order_details', 'Order Details')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 grid grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <div className="text-gray-500">{t('aiResults.order_number', 'Order Number')}</div>
                        <div className="font-medium">{data?.poNumber || '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.status', 'Status')}</div>
                        <div className="font-medium capitalize">{data?.status?.replace(/_/g, ' ') || '-'}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-gray-500">{t('aiResults.vendor', 'Vendor')}</div>
                        <div className="font-medium">{data?.vendorID?.vendorName || '-'}</div>
                        {data?.vendorID?.vendorCode && (
                          <div className="text-[11px] text-gray-600">Code: {data.vendorID.vendorCode}</div>
                        )}
                      </div>
                      {data?.vesselID && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.vessel', 'Vessel')}</div>
                          <div className="font-medium">{data.vesselID?.vesselName || '-'}</div>
                        </div>
                      )}
                      {data?.deliveryLocation && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.delivery_location', 'Delivery Location')}</div>
                          <div className="font-medium">{data.deliveryLocation}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500">{t('aiResults.order_date', 'Order Date')}</div>
                        <div className="font-medium">{data?.orderDate ? new Date(data.orderDate).toLocaleDateString() : '-'}</div>
                      </div>
                      {data?.expectedDeliveryDate && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.expected_delivery', 'Expected Delivery')}</div>
                          <div className="font-medium">{new Date(data.expectedDeliveryDate).toLocaleDateString()}</div>
                        </div>
                      )}
                      {data?.actualDeliveryDate && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.actual_delivery', 'Actual Delivery')}</div>
                          <div className="font-medium">{new Date(data.actualDeliveryDate).toLocaleDateString()}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500">{t('aiResults.total_amount', 'Total Amount')}</div>
                        <div className="font-medium">{data?.currency || 'USD'} {data?.totalAmount?.toFixed(2) || '0.00'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.ordered_by', 'Ordered By')}</div>
                        <div className="font-medium">{data?.orderedBy?.email || '-'}</div>
                      </div>
                      {data?.approvedBy && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.approved_by', 'Approved By')}</div>
                          <div className="font-medium">{data.approvedBy?.email || '-'}</div>
                        </div>
                      )}
                      {data?.specialInstructions && (
                        <div className="col-span-2">
                          <div className="text-gray-500">{t('aiResults.special_instructions', 'Special Instructions')}</div>
                          <div className="font-medium">{data.specialInstructions}</div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Line Items Section */}
                  {data?.lineItems && data.lineItems.length > 0 && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                        {t('aiResults.line_items', 'Line Items')} ({data.lineItems.length})
                      </div>
                      <div className="p-3 space-y-3">
                        {data.lineItems.map((item: any, idx: number) => (
                          <div key={idx} className="border border-[rgba(202,206,214,0.5)] rounded p-2 text-xs">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{item?.partID?.partName || 'Unknown Part'}</div>
                                <div className="text-[11px] text-gray-600">Part #: {item?.partID?.partNumber || '-'}</div>
                              </div>
                              {item?.urgency && item.urgency !== 'normal' && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  item.urgency === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {item.urgency.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                              <div>
                                <span className="text-gray-500">Ordered:</span> <span className="font-medium">{item?.quantity || 0} {item?.partID?.unit || 'pcs'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Received:</span> <span className="font-medium">{item?.receivedQuantity || 0} {item?.partID?.unit || 'pcs'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Unit Price:</span> <span className="font-medium">{data?.currency || 'USD'} {item?.unitPrice?.toFixed(2) || '0.00'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Total:</span> <span className="font-medium">{data?.currency || 'USD'} {item?.totalPrice?.toFixed(2) || '0.00'}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

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
                          {ids.org && ids.pid && (d?.name || d?.fileName) && (
                            <button
                              className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => download(ids.org!, ids.pid!, d?.name || d?.documentName || d?.fileName)}
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

