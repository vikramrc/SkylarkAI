import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FormTemplateRenderer, { type FormTemplateDoc } from './FormTemplateRenderer';

export type FormTemplateViewerHandle = {
  open: (template?: FormTemplateDoc | null) => void;
  close: () => void;
};

export default forwardRef<FormTemplateViewerHandle, { initialOpen?: boolean }>(function FormTemplateViewerDelegate({ initialOpen }, ref) {
  const [open, setOpen] = useState<boolean>(!!initialOpen);
  const [template, setTemplate] = useState<FormTemplateDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const lastActive = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // restore focus to last active element for a11y
    setTimeout(() => lastActive.current?.focus?.(), 0);
  }, []);

  function extractIds(t: any) {
    const src = t || {};
    // ONLY look at sourceMeta.entities.formTemplateId
    const formTemplateId = src?.sourceMeta?.entities?.formTemplateId;
    const org = src?.sourceMeta?.organizationID; // if provided, otherwise will be fetched from backend
    return { org, formTemplateId };
  }

  async function fetchComplete(t: any) {
    const { org: initialOrg, formTemplateId } = extractIds(t || {});
    if (!formTemplateId) return null;

    try {
      setLoading(true);

      // If org is missing, first fetch the template to get organizationID
      let org = initialOrg;
      if (!org) {
        // Try to fetch template without org to get organizationID from response
        console.warn('[FE] organizationID missing in sourceMeta, fetching template to get org...');

        const tempResp = await fetch(`/api/phoenix-cloud/formtemplates/lookup/${formTemplateId}`, {
          credentials: 'include', // Include cookies for authentication
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!tempResp.ok) {
          console.warn('[FE] Failed to lookup FormTemplate organizationID:', tempResp.status, tempResp.statusText);
          return null;
        }
        const tempData = await tempResp.json();
        org = tempData?.organizationID;

        if (!org) {
          console.warn('[FE] organizationID not found in FormTemplate response');
          return null;
        }
      }

      const resp = await fetch(`/api/phoenix-cloud/formtemplates/${org}/template/${formTemplateId}`, {
        credentials: 'include', // Include cookies for authentication
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) throw new Error(`Upstream responded ${resp.status}`);
      const data = await resp.json();

      const mapped: FormTemplateDoc = {
        _id: data?._id || formTemplateId,
        name: data?.name || t?.name,
        organizationID: data?.organizationID || org,
        sections: data?.sections || [],
        fields: data?.fields || [],
      };
      return mapped;
    } catch (e) {
      console.warn('[FE] Failed to load FormTemplate via proxy:', (e as any)?.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  const openWith = useCallback((t?: FormTemplateDoc | null) => {
    lastActive.current = (document.activeElement as HTMLElement) || null;
    setTemplate(t ?? null);
    setOpen(true);
    // Fire and forget: try to load the complete template via BE proxy
    (async () => {
      try {
        const complete = await fetchComplete(t);
        if (complete) setTemplate(complete);
      } catch (e) {
        console.warn('[FE] Failed to load complete FormTemplate via proxy:', (e as any)?.message);
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
            <div className="text-sm font-semibold text-gray-900 truncate">{template?.name || 'Form Template'}</div>
            <button className="text-sm text-gray-600 hover:text-gray-900" onClick={close} aria-label="Close">
              Close
            </button>
          </div>
          <div className="p-4 max-h-[80vh] overflow-y-auto">
            {loading && (
              <div className="text-xs text-gray-500 mb-2">Loading template…</div>
            )}
            {template ? (
              <FormTemplateRenderer template={template} />
            ) : (
              <div className="text-sm text-gray-500">No template data available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
});

