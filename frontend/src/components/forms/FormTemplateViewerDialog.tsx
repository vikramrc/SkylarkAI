import React, { useEffect } from 'react';
import FormTemplateRenderer, { type FormTemplateDoc } from './FormTemplateRenderer';

export default function FormTemplateViewerDialog({
  open,
  onClose,
  template
}: {
  open: boolean;
  onClose: () => void;
  template?: FormTemplateDoc | null;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl border border-[rgba(202,206,214,0.5)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(202,206,214,0.5)]">
            <div className="text-sm font-semibold text-gray-900 truncate">{template?.name || 'Form Template'}</div>
            <button className="text-sm text-gray-600 hover:text-gray-900" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
          <div className="p-4 max-h-[80vh] overflow-y-auto">
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
}

