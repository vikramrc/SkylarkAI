import React from 'react';

export interface FormTemplateDoc {
  _id?: string;
  name?: string;
  organizationID?: string;
  sections?: Array<{
    id: string;
    title?: string;
    description?: string;
    columns?: number;
    order?: number;
  }>;
  fields?: Array<{
    id?: string;
    key?: string;
    label?: string;
    type?: string;
    sectionId?: string;
    order?: number;
    lineBreak?: boolean;
    pageBreak?: boolean;
    required?: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    files?: Array<{ id?: string; name?: string; originalName?: string; fileName?: string }>;
  }>;
}

export default function FormTemplateRenderer({ template }: { template: FormTemplateDoc }) {
  const fields = template?.fields ?? [];
  const layout = normalizeTemplateLayout(template);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-semibold text-gray-900">{template?.name || 'Form Template'}</div>
          <div className="text-xs text-gray-600 mt-1">Template Structure</div>
        </div>
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
                    return (
                      <div key={key} className={`col-span-12 ${colSpanClass}`}>
                        <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1" title={label}>
                          {label}
                          {sf?.required && (
                            <span className="text-red-500 text-xs">*</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-900">
                          <FieldPreview template={template} field={sf} />
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
          {fields.map((f, idx) => (
            <div key={f.id || f.key || idx} className="grid grid-cols-3 gap-3 p-3">
              <div className="col-span-1 text-xs font-medium text-gray-700 truncate flex items-center gap-1" title={f.label}>
                {f.label || f.id || f.key}
                {f?.required && (
                  <span className="text-red-500 text-xs">*</span>
                )}
              </div>
              <div className="col-span-2 text-sm text-gray-900">
                <FieldPreview template={template} field={f} />
              </div>
            </div>
          ))}
          {fields.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No fields to display</div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldPreview({ template, field }: { template: FormTemplateDoc; field?: any }) {
  const type = field?.type;
  const placeholder = field?.placeholder;
  const options = field?.options || [];
  const files = field?.files || [];

  // Available Files (template-provided)
  if (type === 'availableFiles') {
    if (!files.length) return <span className="text-gray-400 text-xs italic">No files available.</span>;
    return (
      <ul className="list-disc pl-5 space-y-1">
        {files.map((f: any, i: number) => {
          const fname = f?.name || f?.originalName || f?.fileName || `file-${i}`;
          const fid = f?.id || f?._id || '';
          const url = template.organizationID && template._id && field?.id && fid
            ? `/api/phoenix-cloud/formtemplates/${template.organizationID}/template/${template._id}/download/${field.id}/${fid}`
            : undefined;
          return (
            <li key={i} className="text-sm text-gray-900">
              {fname}
              {url && (
                <button
                  className="ml-2 text-blue-600 hover:underline text-xs"
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

  // Dropdown/Select/Radio/Checkbox with options
  if ((type === 'dropdown' || type === 'select' || type === 'radio' || type === 'checkbox') && options.length > 0) {
    return (
      <div className="text-xs text-gray-500 italic">
        Options: {options.map((opt: any) => opt.label || opt.value).join(', ')}
      </div>
    );
  }

  // File upload field
  if (type === 'file' || type === 'files') {
    return <span className="text-gray-400 text-xs italic">File upload field</span>;
  }

  // Text/Number/Date/etc. - show placeholder or field type
  const displayText = placeholder || `[${type || 'text'}]`;
  return <span className="text-gray-400 text-xs italic">{displayText}</span>;
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

// Build section-aware layout from template; hides empty sections
function normalizeTemplateLayout(template?: FormTemplateDoc): Array<{ section: any; fields: any[] }> {
  const sections = template?.sections || [];
  const fields = template?.fields || [];
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

