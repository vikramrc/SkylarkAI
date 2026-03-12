import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Tag, X } from 'lucide-react';
import WorkHistoryViewerDelegate, { type WorkHistoryViewerHandle } from '../../work-history/WorkHistoryViewerDelegate';
import FormViewerDelegate, { type FormViewerHandle } from '../../forms/FormViewerDelegate';
import DocumentViewerDelegate, { type DocumentViewerHandle } from '../../documents/DocumentViewerDelegate';

export type TagPanelHandle = {
  open: (tagData?: any | null) => void;
  close: () => void;
};

type TabType = 'work_history' | 'forms' | 'documents';

export default forwardRef<TagPanelHandle, { initialOpen?: boolean }>(function TagPanelDelegate({ initialOpen }, ref) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(!!initialOpen);
  const [tagData, setTagData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('work_history');
  const lastActive = useRef<HTMLElement | null>(null);

  const awhViewerRef = useRef<WorkHistoryViewerHandle>(null);
  const formViewerRef = useRef<FormViewerHandle>(null);
  const docViewerRef = useRef<DocumentViewerHandle>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => lastActive.current?.focus?.(), 0);
  }, []);

  const openWith = useCallback((data?: any | null) => {
    lastActive.current = (document.activeElement as HTMLElement) || null;
    setTagData(data ?? null);
    setOpen(true);
    // Reset to first tab with items
    const items = Array.isArray(data?.taggedItems) ? data.taggedItems : [];
    const hasAwh = items.some((item: any) => item.itemType === 'ActivityWorkHistory');
    const hasForms = items.some((item: any) => item.itemType === 'Form');
    const hasDocs = items.some((item: any) => item.itemType === 'DocumentMetadata');
    if (hasAwh) setActiveTab('work_history');
    else if (hasForms) setActiveTab('forms');
    else if (hasDocs) setActiveTab('documents');
    else setActiveTab('work_history');
  }, []);

  useImperativeHandle(ref, () => ({ open: openWith, close }), [openWith, close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const tagName = tagData?.tagName || t('aiResults.unknown_tag', 'Unknown Tag');
  const tagColor = tagData?.tagColor || '#1976d2';
  const taggedItems = Array.isArray(tagData?.taggedItems) ? tagData.taggedItems : [];

  // Filter items by type - exclude FormTemplate
  const awhItems = taggedItems.filter((item: any) => item.itemType === 'ActivityWorkHistory');
  const formItems = taggedItems.filter((item: any) => item.itemType === 'Form');
  const docItems = taggedItems.filter((item: any) => item.itemType === 'DocumentMetadata');

  const handleItemClick = (item: any) => {
    const itemType = item.itemType;
    const sourceMeta = item.sourceMeta;

    if (!sourceMeta) {
      console.warn('[TagPanel] Item missing sourceMeta:', item);
      return;
    }

    if (itemType === 'ActivityWorkHistory') {
      awhViewerRef.current?.open({ sourceMeta });
    } else if (itemType === 'Form' || itemType === 'FormTemplate') {
      // FormViewerDelegate expects an object with sourceMeta
      const formData = {
        _id: sourceMeta.entities?.formId || sourceMeta.entities?.formTemplateId,
        organizationID: sourceMeta.organizationID,
        name: item.displayName,
        sourceMeta: sourceMeta,
      };
      formViewerRef.current?.open(formData);
    } else if (itemType === 'DocumentMetadata') {
      docViewerRef.current?.open({ sourceMeta });
    }
  };

  const getItemTypeLabel = (itemType: string) => {
    if (itemType === 'ActivityWorkHistory') return t('aiResults.view_awh', 'View AWH');
    if (itemType === 'Form') return t('aiResults.view_form', 'View Form');
    if (itemType === 'FormTemplate') return t('aiResults.view_form_template', 'View Form Template');
    if (itemType === 'DocumentMetadata') return t('aiResults.view_document', 'View Document');
    return t('aiResults.view', 'View');
  };

  const renderTabContent = () => {
    let items: any[] = [];
    if (activeTab === 'work_history') items = awhItems;
    else if (activeTab === 'forms') items = formItems;
    else if (activeTab === 'documents') items = docItems;

    if (items.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500 text-sm">
          {t('aiResults.no_items', 'No items')}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {items.map((item: any, idx: number) => {
          const displayName = item.displayName || item.itemID || `Item ${idx + 1}`;
          const itemTypeLabel = getItemTypeLabel(item.itemType);
          return (
            <button
              key={idx}
              className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 transition text-sm flex items-center justify-between group"
              onClick={() => handleItemClick(item)}
            >
              <span className="truncate flex-1">{displayName}</span>
              <span className="text-xs text-blue-600 group-hover:text-blue-800 ml-2 shrink-0">
                {itemTypeLabel}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border"
              style={{
                backgroundColor: `${tagColor}15`,
                borderColor: tagColor,
                color: tagColor,
              }}
            >
              <Tag className="w-4 h-4" />
            </span>
            <h2 className="text-lg font-semibold" style={{ color: tagColor }}>
              {tagName}
            </h2>
          </div>
          <button
            className="p-1 rounded-md hover:bg-gray-100 transition"
            onClick={close}
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'work_history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveTab('work_history')}
          >
            {t('aiResults.work_history_tab', 'Work History')}
            {awhItems.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                {awhItems.length}
              </span>
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'forms'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveTab('forms')}
          >
            {t('aiResults.forms_tab', 'Forms')}
            {formItems.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                {formItems.length}
              </span>
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'documents'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveTab('documents')}
          >
            {t('aiResults.documents_tab', 'Documents')}
            {docItems.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                {docItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderTabContent()}
        </div>
      </div>

      {/* Viewer Delegates */}
      <WorkHistoryViewerDelegate ref={awhViewerRef} />
      <FormViewerDelegate ref={formViewerRef} />
      <DocumentViewerDelegate ref={docViewerRef} />
    </div>,
    document.body
  );
});

