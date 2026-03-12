import React from 'react';

export interface FormDoc {
  _id?: string;
  name?: string;
  status?: string;
  submittedAt?: string;
  committedAt?: string;
  organizationID?: string; // needed for downloads via proxy
  templateId?: string; // needed for availableFiles downloads
  formData?: Record<string, any>;
  templateSnapshot?: {
    name?: string;
    sections?: Array<{ id: string; title?: string; description?: string; columns?: number; order?: number }>;
    fields?: Array<{
      id?: string; // preferred
      key?: string; // fallback
      label?: string;
      type?: string;
      sectionId?: string;
      order?: number;
      lineBreak?: boolean;
      pageBreak?: boolean;
      options?: Array<{ value: string; label: string }>;
      files?: Array<{ id?: string; name?: string; originalName?: string; fileName?: string }>;
    }>;
  };
}

export default function FormRenderer({ form }: { form: FormDoc }) {
  // console.log('FormRenderer: ', form);
  const fields = form?.templateSnapshot?.fields ?? [];
  const values = form?.formData ?? {};

  const layout = normalizeTemplateLayout(form?.templateSnapshot);


  const orderedEntries: Array<{ key: string; label: string; type?: string; field?: any }> =
    fields.length
      ? fields.map(f => ({ key: f.id || f.key || '', label: f.label || (f.id || f.key || ''), type: f.type, field: f }))
      : Object.keys(values).map(k => ({ key: k, label: k }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-semibold text-gray-900">{form?.name || 'Form'}</div>
          <div className="text-xs text-gray-600 mt-1 space-x-2">
            {form?.templateSnapshot?.name && <span>{form.templateSnapshot.name}</span>}
            {form?.submittedAt && <span>{formatDateTime(form.submittedAt)}</span>}
            {form?.committedAt && <span>• {formatDateTime(form.committedAt)}</span>}
          </div>
        </div>
        {form?.status && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 capitalize">
            {form.status}
          </span>
        )}
      </div>

      {/* Sections layout (preferred) or fallback to flat list */}
      {layout && layout.length > 0 ? (
        <div className="space-y-4">
          {layout.map((entry: { section: any; fields: any[] }, sIdx: number) => {
            const { section, fields: sFields } = entry;
            return (
              <div key={section.id} className="rounded-md border border-[rgba(202,206,214,0.5)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[rgba(202,206,214,0.5)] bg-gray-50">
                  <div className="text-sm font-semibold text-gray-900">{section.title || `Section ${sIdx + 1}`}</div>
                  {section.description && (
                    <div className="text-xs text-gray-500 mt-0.5">{section.description}</div>
                  )}
                </div>
                <div className="p-3 grid grid-cols-12 gap-3">
                  {sFields.map((sf: any, i: number) => {
                    const cols = Math.max(1, Math.min(4, section.columns || 1));
                    const span = sf?.lineBreak ? 12 : Math.floor(12 / cols);
                    const colSpanClass = span === 12 ? 'md:col-span-12' : span === 6 ? 'md:col-span-6' : span === 4 ? 'md:col-span-4' : 'md:col-span-3';
                    const key = sf?.id || sf?.key || i;
                    const label = sf?.label || sf?.id || sf?.key || '';
                    const vkey = (sf?.id || sf?.key || '') as string;
                    return (
                      <div key={key} className={`col-span-12 ${colSpanClass}`}>
                        <div className="text-xs font-medium text-gray-700 mb-1" title={label}>{label}</div>
                        <div className="text-sm text-gray-900">
                          <FieldValue form={form} field={sf} value={values[vkey]} type={sf?.type} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-[rgba(202,206,214,0.5)] rounded-md border border-[rgba(202,206,214,0.5)] overflow-hidden">
          {orderedEntries.map((f, idx) => (
            <div key={f.key || idx} className="grid grid-cols-3 gap-3 p-3">
              <div className="col-span-1 text-xs font-medium text-gray-700 truncate" title={f.label}>{f.label}</div>
              <div className="col-span-2 text-sm text-gray-900">
                <FieldValue form={form} field={f.field} value={values[f.key]} type={f.type} />
              </div>
            </div>
          ))}
          {orderedEntries.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No fields to display</div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldValue({ form, field, value, type }: { form: FormDoc; field?: any; value: any; type?: string }) {
  if (value == null || value === '') {
    // For availableFiles, we still want to show the list even if value is empty
    if (type !== 'availableFiles') return <span className="text-gray-400">—</span>;
  }

  // Available Files (template-provided)
  if (type === 'availableFiles') {
    const files = (field?.files || []) as Array<any>;
    if (!files.length) return <span className="text-gray-400">No files available.</span>;
    return (
      <ul className="list-disc pl-5 space-y-1">
        {files.map((f, i) => {
          const fname = f?.name || f?.originalName || f?.fileName || `file-${i}`;
          const fid = f?.id || f?._id || '';
          const url = form.organizationID && form.templateId && field?.id && fid
            ? `/api/phoenix-cloud/formtemplates/${form.organizationID}/template/${form.templateId}/download/${field.id}/${fid}`
            : undefined;
          return (
            <li key={i} className="text-sm text-gray-900">
              {fname}
              {url && (
                <button
                  className="ml-2 text-blue-600 hover:underline"
                  onClick={() => downloadViaProxy(url, fname)}
                >
                  Download
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  // file(s) uploaded by user
  if (type === 'file' || type === 'files') {
    const files = Array.isArray(value) ? value : [value];
    return (
      <ul className="list-disc pl-5 space-y-1">
        {files.map((f, i) => {
          const name = f?.originalName || f?.fileName || String(f);
          const fid = f?.id || f?._id || f?.fileId;
          const fieldId = field?.id || field?.key;
          const url = form.organizationID && form._id && fieldId && fid
            ? `/api/phoenix-cloud/forms/${form.organizationID}/forms/${form._id}/fields/${fieldId}/files/${fid}/download`
            : undefined;
          return (
            <li key={i} className="text-sm text-gray-900">
              {name}
              {url && (
                <button
                  className="ml-2 text-blue-600 hover:underline"
                  onClick={() => downloadViaProxy(url, name)}
                >
                  Download
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  // boolean
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;

  // number
  if (typeof value === 'number') return <span>{value.toLocaleString()}</span>;

  // date/datetime heuristics
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return <span>{formatDateTime(value)}</span>;
  }

  // arrays (multi-select, etc.)
  if (Array.isArray(value)) {
    return <span>{value.map(v => formatPrimitive(v)).join(', ')}</span>;
  }

  // default
  return <span>{formatPrimitive(value)}</span>;
}

async function downloadViaProxy(url: string, filename: string) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    console.warn('[FE] Download failed:', (e as any)?.message);
  }
}

function formatPrimitive(v: any) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  try { return JSON.stringify(v); } catch { return String(v); }
}

function formatDateTime(v?: string) {
  try { const d = v ? new Date(v) : null; if (d && !isNaN(d as any)) return d.toLocaleString(); } catch {}
  return v || '';
}

// Build section-aware layout from template snapshot; hides empty sections
function normalizeTemplateLayout(snapshot?: FormDoc['templateSnapshot']): Array<{ section: any; fields: any[] }> {
  const sections = snapshot?.sections || [];
  const fields = snapshot?.fields || [];
  if (!sections.length || !fields.length) return [];

  const sortedSections = [...sections].sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0));
  const bySection = new Map<string, { section: any; fields: any[] }>();
  sortedSections.forEach((s: any) => bySection.set(s.id, { section: s, fields: [] }));

  fields.forEach((f: any) => {
    const sid = f?.sectionId;
    if (sid && bySection.has(sid)) {
      bySection.get(sid)!.fields.push(f);
    }
  });

  const result = Array.from(bySection.values()).map(({ section, fields }) => ({
    section,
    fields: [...fields].sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0)),
  }));

  // Hide sections with no fields
  return result.filter(entry => entry.fields.length > 0);
}


