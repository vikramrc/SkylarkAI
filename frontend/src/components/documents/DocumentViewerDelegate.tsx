import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type DocumentViewerHandle = {
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

function formatFileSize(bytes?: number) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function documentStatusChipClass(status?: string) {
  const k = String(status || '').toLowerCase();
  if (k === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (k === 'archived') return 'bg-gray-50 text-gray-700 border-gray-200';
  if (k === 'draft') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

async function downloadDocument(orgId: string, documentId: string, fileName: string, versionId?: string) {
  try {
    // Use document metadata ID to download, matching PhoenixCloudFE2's approach
    let url = `/api/phoenix-cloud/documents/${orgId}/documents/${documentId}/download`;
    if (versionId) {
      url += `?versionId=${versionId}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    console.warn('[DOC][DOWNLOAD_ERR]', e);
    alert('Failed to download file');
  }
}

export default forwardRef<DocumentViewerHandle, { initialOpen?: boolean }>(
  function DocumentViewerDelegate({ initialOpen }, ref) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<boolean>(!!initialOpen);
    const [row, setRow] = useState<any | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [doc, setDoc] = useState<any | null>(null);
    const [versions, setVersions] = useState<any[]>([]);
    const [showVersionHistory, setShowVersionHistory] = useState<boolean>(false);
    const lastActive = useRef<HTMLElement | null>(null);

    function isLikelyObjectId(v: any): boolean {
      return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
    }

    // ID resolution
    const ids = useMemo(() => {
      const src = row || {};
      const org = src?.sourceMeta?.organizationID || src?.organizationID || src?.organization_ID;
      const docIdRaw = src?.sourceMeta?.entities?.documentMetadataId || src?._id;
      const docId = isLikelyObjectId(docIdRaw) ? docIdRaw : undefined;
      return { org, docId };
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
          // If we have org and docId, fetch from API; otherwise use row data
          if (ids.org && ids.docId) {
            const [metaResp, versionsResp] = await Promise.allSettled([
              fetch(`/api/phoenix-cloud/documents/${ids.org}/metadata/${ids.docId}`),
              fetch(`/api/phoenix-cloud/documents/${ids.org}/metadata/${ids.docId}/versions`)
            ]);

            if (metaResp.status === 'fulfilled' && metaResp.value.ok) {
              const metaJson = await metaResp.value.json();
              setDoc(metaJson);
            } else {
              setDoc(row);
            }

            if (versionsResp.status === 'fulfilled' && versionsResp.value.ok) {
              const versionsJson = await versionsResp.value.json();
              setVersions(Array.isArray(versionsJson) ? versionsJson : []);
            } else {
              setVersions([]);
            }
          } else {
            // Use row data directly
            setDoc(row);
            setVersions([]);
          }
        } catch (e) {
          console.warn('[DOC][ERR]', e);
          setDoc(row); // Fallback to row data
          setVersions([]);
        } finally {
          setLoading(false);
        }
      })();
    }, [open, ids.org, ids.docId, row]);

    // Extract fields
    const data = doc || row || {};
    const documentName = data?.documentName || data?.name || '-';
    const documentType = data?.documentType || '-';
    const description = data?.description || '-';
    const status = data?.status || 'active';
    const vesselName = data?.vesselID?.vesselName || data?.vesselName || data?.vessel_ID || (data?.vesselID ? '-' : 'Organization-wide');
    const currentVersion = data?.currentVersionId || data?.currentVersion;
    const createdBy = (typeof data?.createdBy === 'object' ? data?.createdBy?.email : data?.createdBy) || '-';
    const createdAt = data?.createdAt;
    const updatedBy = (typeof data?.updatedBy === 'object' ? data?.updatedBy?.email : data?.updatedBy) || '-';
    const updatedAt = data?.updatedAt;
    const docId = data?._id || '-';

    // Current version details
    const currentVersionNumber = currentVersion?.version || '-';
    const fileName = currentVersion?.fileName || data?.fileName || '-';
    const originalFileName = currentVersion?.originalFileName || data?.originalFileName || '-';
    const fileSize = currentVersion?.fileSize || data?.fileSize;
    const mimeType = currentVersion?.mimeType || data?.mimeType || data?.contentType || '-';
    const uploadedBy = (typeof currentVersion?.uploadedBy === 'object' ? currentVersion?.uploadedBy?.email : currentVersion?.uploadedBy) || '-';
    const uploadedAt = currentVersion?.uploadedAt;
    const approvedBy = (typeof currentVersion?.approvedBy === 'object' ? currentVersion?.approvedBy?.email : currentVersion?.approvedBy) || '-';
    const approvedAt = currentVersion?.approvedAt;
    const currentVersionId = currentVersion?._id; // DocumentFile ID for version-specific downloads

    // Custom metadata fields
    const customMetadata = data?.customMetadata || {};
    const hasCustomFields = Object.keys(customMetadata).length > 0;

    // Helper to format field name (camelCase to Title Case)
    const formatFieldName = (fieldName: string): string => {
      return fieldName
        .replace(/([A-Z])/g, ' $1') // Add space before capital letters
        .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
        .trim();
    };

    // Helper to format field value
    const formatFieldValue = (value: any): string => {
      if (value === null || value === undefined) return '-';

      // Check if it's a date string
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return formatDate(value);
          }
        } catch {
          // Not a valid date, continue
        }
      }

      // Check if it's an ObjectId (24 hex characters)
      if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) {
        return `Reference (${value.substring(0, 8)}...)`;
      }

      // Check if it's an array of ObjectIds
      if (Array.isArray(value)) {
        if (value.length === 0) return '-';
        if (value.every(v => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v))) {
          return `${value.length} Reference(s)`;
        }
        return value.join(', ');
      }

      // Check if it's a boolean
      if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
      }

      // Check if it's a number
      if (typeof value === 'number') {
        return value.toString();
      }

      // Default: convert to string
      return String(value);
    };

    // Render portal
    return open ? createPortal(
      <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
        <div className="absolute inset-0 bg-black/40" onClick={close} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)] h-[72vh] max-h-[80vh] min-h-[60vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{t('aiResults.document_details', 'Document Details')}</div>
                <div className="mt-1 text-xs text-gray-900 truncate font-medium">{documentName}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${documentStatusChipClass(status)}`}>
                  {String(status)}
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
                  {/* Document Information */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.document_information', 'Document Information')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 space-y-2">
                      <div>
                        <div className="text-gray-500">{t('aiResults.document_name', 'Document Name')}</div>
                        <div>{documentName}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.document_type', 'Document Type')}</div>
                        <div>{documentType}</div>
                      </div>
                      {description !== '-' && (
                        <div>
                          <div className="text-gray-500">{t('aiResults.description', 'Description')}</div>
                          <div>{description}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500">{t('aiResults.status', 'Status')}</div>
                        <div className="capitalize">{status}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.vessel', 'Vessel')}</div>
                        <div>{vesselName}</div>
                      </div>
                    </div>
                  </section>

                  {/* Custom Fields */}
                  {hasCustomFields && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                        {t('aiResults.custom_fields', 'Custom Fields')}
                      </div>
                      <div className="p-3 text-xs text-gray-800 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        {Object.entries(customMetadata).map(([fieldName, value]) => (
                          <div key={fieldName}>
                            <div className="text-gray-500">{formatFieldName(fieldName)}</div>
                            <div>{formatFieldValue(value)}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Current Version */}
                  {currentVersion && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                        {t('aiResults.current_version', 'Current Version')}
                      </div>
                      <div className="p-3 text-xs text-gray-800 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                          <div>
                            <div className="text-gray-500">{t('aiResults.version', 'Version')}</div>
                            <div>{currentVersionNumber}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.file_size', 'File Size')}</div>
                            <div>{formatFileSize(fileSize)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.file_name', 'File Name')}</div>
                            <div>{fileName}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.original_file_name', 'Original File Name')}</div>
                            <div>{originalFileName}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.mime_type', 'MIME Type')}</div>
                            <div>{mimeType}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.uploaded_by', 'Uploaded By')}</div>
                            <div>{uploadedBy}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">{t('aiResults.uploaded_at', 'Uploaded At')}</div>
                            <div>{uploadedAt ? formatDateTime(uploadedAt) : '-'}</div>
                          </div>
                          {approvedBy !== '-' && (
                            <>
                              <div>
                                <div className="text-gray-500">{t('aiResults.approved_by', 'Approved By')}</div>
                                <div>{approvedBy}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">{t('aiResults.approved_at', 'Approved At')}</div>
                                <div>{approvedAt ? formatDateTime(approvedAt) : '-'}</div>
                              </div>
                            </>
                          )}
                        </div>
                        {ids.org && ids.docId && (
                          <div className="pt-2">
                            <button
                              className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => downloadDocument(ids.org!, ids.docId!, originalFileName)}
                            >
                              {t('aiResults.download_current_version', 'Download Current Version')}
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Version History */}
                  {versions.length > 0 && (
                    <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                      <button
                        className="w-full px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900 flex items-center justify-between hover:bg-gray-50"
                        onClick={() => setShowVersionHistory(s => !s)}
                      >
                        <span>{t('aiResults.version_history', 'Version History')}</span>
                        <span className="text-xs text-gray-500">{showVersionHistory ? '▼' : '▶'}</span>
                      </button>
                      {showVersionHistory && (
                        <div className="p-3 space-y-3">
                          {versions.map((ver: any, idx: number) => {
                            const isCurrent = ver?.isLatest || ver?._id === currentVersionId;
                            const versionId = ver?._id; // DocumentFile ID for version-specific download
                            return (
                              <div key={idx} className="border border-[rgba(202,206,214,0.5)] rounded p-2 text-xs">
                                <div className="font-medium text-gray-900">
                                  Version {ver?.version || '-'} {isCurrent && '(Current)'}
                                </div>
                                <div className="text-gray-600 mt-1">
                                  Uploaded: {ver?.uploadedAt ? formatDateTime(ver.uploadedAt) : '-'} by {(typeof ver?.uploadedBy === 'object' ? ver?.uploadedBy?.email : ver?.uploadedBy) || '-'}
                                </div>
                                {ver?.versionDescription && (
                                  <div className="text-gray-600 mt-1">
                                    Description: {ver.versionDescription}
                                  </div>
                                )}
                                {ids.org && ids.docId && versionId && (
                                  <button
                                    className="mt-2 text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                                    onClick={() => downloadDocument(ids.org!, ids.docId!, ver?.originalFileName || ver?.fileName || `version-${ver?.version}`, versionId)}
                                  >
                                    {t('aiResults.download', 'Download')}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  {/* Metadata */}
                  <section className="rounded-md border border-[rgba(202,206,214,0.5)]">
                    <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] text-sm font-semibold text-gray-900">
                      {t('aiResults.metadata', 'Metadata')}
                    </div>
                    <div className="p-3 text-xs text-gray-800 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                      <div>
                        <div className="text-gray-500">{t('aiResults.created_by', 'Created By')}</div>
                        <div>{createdBy}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.created_at', 'Created At')}</div>
                        <div>{createdAt ? formatDateTime(createdAt) : '-'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.updated_by', 'Updated By')}</div>
                        <div>{updatedBy}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('aiResults.updated_at', 'Updated At')}</div>
                        <div>{updatedAt ? formatDateTime(updatedAt) : '-'}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-gray-500">{t('aiResults.document_id', 'Document ID')}</div>
                        <div className="font-mono text-[10px]">{docId}</div>
                      </div>
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

