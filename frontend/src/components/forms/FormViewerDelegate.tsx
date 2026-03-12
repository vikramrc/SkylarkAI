import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FormRenderer, { type FormDoc } from './FormRenderer';

export type FormViewerHandle = {
  open: (form?: FormDoc | null) => void;
  close: () => void;
};

export default forwardRef<FormViewerHandle, { initialOpen?: boolean }>(function FormViewerDelegate({ initialOpen }, ref) {
  const [open, setOpen] = useState<boolean>(!!initialOpen);
  const [form, setForm] = useState<FormDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const lastActive = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // restore focus to last active element for a11y
    setTimeout(() => lastActive.current?.focus?.(), 0);
  }, []);

  function extractIds(f: any) {
    const src = f || {};
    // Prefer canonical IDs injected by BE enrichment
    const org = src?.sourceMeta?.organizationID;
    const formId = src?.sourceMeta?.entities?.formId;
    return { org, formId };
  }

  async function fetchComplete(f: any) {
    // console.log('FormViewerDelegate: Fetching complete form:', f);
    const { org, formId } = extractIds(f || {});
    // console.log('Extracted IDs:', { org, formId });
    if (!org || !formId) return null;
    try {
      setLoading(true);
      const resp = await fetch(`/api/phoenix-cloud/forms/${org}/forms/${formId}/complete`);
      if (!resp.ok) throw new Error(`Upstream responded ${resp.status}`);
      const data = await resp.json();
      // console.log('API fetched complete form:', data);
      const tpl = data?.formTemplateID || {};
      const mapped: FormDoc = {
        _id: data?._id || formId,
        name: data?.name || f?.name,
        status: data?.status || f?.status,
        submittedAt: data?.submittedAt || f?.submittedAt,
        committedAt: data?.committedAt || f?.committedAt,
        formData: data?.formData || f?.formData || {},
        // IMPORTANT: include sections to preserve layout
        templateSnapshot: tpl?.fields ? { name: tpl?.name, sections: tpl?.sections, fields: tpl.fields } : (f?.templateSnapshot || undefined),
        organizationID: data?.organizationID || org,
        templateId: tpl?._id,
      } as any;
      return mapped;
    } finally {
      setLoading(false);
    }
  }

  const openWith = useCallback((f?: FormDoc | null) => {
    // console.log('FormViewerDelegate: Opening form:', f);
    lastActive.current = (document.activeElement as HTMLElement) || null;
    setForm(f ?? null);
    setOpen(true);
    // Fire and forget: try to load the complete form via BE proxy
    (async () => {
      try {
        const complete = await fetchComplete(f);
        if (complete) setForm(complete);
      } catch (e) {
        console.warn('[FE] Failed to load complete form via proxy:', (e as any)?.message);
      }
    })();
  }, []);

  useImperativeHandle(ref, () => ({ open: openWith, close }), [openWith, close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
            <div className="text-sm font-semibold text-gray-900 truncate">{form?.name || 'Form'}</div>
            <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close} aria-label="Close">
              Close
            </button>
          </div>
          <div className="p-4">
            {loading && (
              <div className="text-xs text-gray-500 mb-2">Loading complete form…</div>
            )}
            {form ? (
              <FormRenderer form={form} />
            ) : (
              <div className="text-sm text-gray-500">No form data available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
});

