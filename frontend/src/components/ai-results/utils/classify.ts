export type Section = {
  type: string;
  items: any[];
};

const normalize = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Base collection / array-key to internal type mapping
export const baseMap: Record<string, string> = {
  // Work history and related
  activityworkhistory: 'work_history',
  activityhistory: 'work_history',
  activityhistoryevents: 'work_history',
  activityworkhistoryevent: 'work_history',

  // Schedule and related
  maintenanceschedule: 'schedule',
  schedule: 'schedule',
  overduetasks: 'schedule',

  // Documents / Files
  documents: 'document',
  document: 'document',
  files: 'document',
  dmsfiles: 'document',

  // Forms (instances) and responses
  form: 'form',
  forms: 'form',
  formresponses: 'form',
  validatedforms: 'form',
  attachedforms: 'form', // AWH-attached forms should render as Form cards

  // Form Templates
  formtemplates: 'form_template',
  formtemplate: 'form_template',

  // Orders
  replenishorder: 'replenish_order',
  replenishorders: 'replenish_order',
  purchaseorder: 'purchase_order',
  purchaseorders: 'purchase_order',

  // Inventory usage / transactions
  inventorytransaction: 'inventory_usage',
  inventorytransactions: 'inventory_usage',
  partusage: 'inventory_usage',
  inventoryusage: 'inventory_usage',

  // Inventory Stock (should be Generic)
  inventorystock: 'inventory_stock',
  inventorystocks: 'inventory_stock',
  inventorypart: 'inventory_part',
  inventoryparts: 'inventory_part',

  // Tags
  searchabletag: 'tag',
  searchabletags: 'tag',
  tag: 'tag',
  tags: 'tag',
};

export function classifyByBase(base?: string): string | undefined {
  const key = normalize(base);
  return baseMap[key];
}

const isPlainObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const isPrimitive = (v: any) => v === null || v === undefined || typeof v !== 'object';

function nonEmptyObject(obj: any) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
}

function scoreItemType(r: any): Record<string, number> {
  const s: Record<string, number> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(r || {}, k);

  // explicit type signal
  if (typeof r?.type === 'string') s[r.type] = (s[r.type] || 0) + 5;

  // Transformed records (e.g., Forms → AWH transformation)
  if (r?._transformedFrom === 'forms') s.work_history = (s.work_history || 0) + 10;

  // Activity Work History (top-level)
  if (has('activityCompletionStatus')) s.work_history = (s.work_history || 0) + 3;
  if (has('performedOn')) s.work_history = (s.work_history || 0) + 3;
  if (has('performedBy') || has('performedByEmail')) s.work_history = (s.work_history || 0) + 1;

  // Activity Work History (nested latestEvent)
  const ev = r?.latestEvent;
  if (ev && typeof ev === 'object') {
    if (Object.prototype.hasOwnProperty.call(ev, 'activityCompletionStatus')) s.work_history = (s.work_history || 0) + 3;
    if (Object.prototype.hasOwnProperty.call(ev, 'performedOn')) s.work_history = (s.work_history || 0) + 3;
    if (Object.prototype.hasOwnProperty.call(ev, 'performedBy')) s.work_history = (s.work_history || 0) + 1;
  }

  // Form (instance) — only when it actually contains data
  // Note: validatedForms is a relationship field on AWH, not a type indicator
  // Only score as form if the record itself has form-specific fields
  if (nonEmptyObject(r?.formData)) s.form = (s.form || 0) + 2;
  if (nonEmptyObject(r?.validatedForms?.formData)) s.form = (s.form || 0) + 2;
  if (has('formTemplateID') || has('formTemplateName')) {
    // Only count formTemplateID as form indicator if NOT an AWH record
    // AWH records can have formTemplateID in attachedForms but are not forms themselves
    if (!has('activityCompletionStatus') && !has('ActivityWorkHistory_ID') && !has('activityWorkHistoryID')) {
      s.form = (s.form || 0) + 1;
    }
  }

  // Document / File
  if (has('originalName') || has('fileName') || has('documentName')) s.document = (s.document || 0) + 2;
  if (has('contentType') || has('mimeType') || has('size') || has('uploadedAt')) s.document = (s.document || 0) + 1;

  // Form Template
  if (has('fields') && (has('name') || has('description'))) s.form_template = (s.form_template || 0) + 2;

  // Inventory usage (InventoryTransaction or legacy part usage)
  // Only classify as transaction if it has transaction-specific fields
  // Avoid misclassifying InventoryStock records (which have currentQuantity, availableQuantity, reservedQuantity)
  const hasStockFields = has('currentQuantity') || has('availableQuantity') || has('reservedQuantity');
  const hasTransactionFields = has('transactionType') || has('quantityUsed') || has('quantityReturned') || has('fromLocationID') || has('toLocationID');
  
  if (hasStockFields) {
    s.inventory_stock = (s.inventory_stock || 0) + 5;
  }

  if (hasTransactionFields && !hasStockFields) {
    s.inventory_usage = (s.inventory_usage || 0) + 3;
  } else if (has('quantity') && !hasStockFields) {
    // Generic 'quantity' field only counts if no stock-specific fields present
    s.inventory_usage = (s.inventory_usage || 0) + 1;
  }
  // Note: partID and partName are too generic - they appear in both stock and transactions


  // Schedule / Overdue (be conservative to avoid overpowering base type)
  if (has('shortName') || has('maintenanceScheduleDescription')) s.schedule = (s.schedule || 0) + 2;
  if (has('plannedDueDate') || has('nextActivityDetails')) s.schedule = (s.schedule || 0) + 1;
  if (has('status') && ['overdue','rescheduled'].includes(String(r.status).toLowerCase())) s.schedule = (s.schedule || 0) + 2;

  // Tag (SearchableTag)
  if (has('tagName') && has('tagColor')) s.tag = (s.tag || 0) + 5;
  if (has('SearchableTag_ID')) s.tag = (s.tag || 0) + 3;
  if (Array.isArray(r?.taggedItems)) s.tag = (s.tag || 0) + 2;

  return s;
}

export function classifyItemType(r: any, baseType?: string): string {
  if (typeof r?.type === 'string') return r.type;
  const scores = scoreItemType(r);
  // Strong bias toward baseType if present
  if (baseType) scores[baseType] = (scores[baseType] || 0) + 5;
  const entries = Object.entries(scores);
  if (entries.length === 0) return 'other';
  entries.sort((a,b)=> (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])));
  const candidate = entries[0][0];

  // DEBUG: Log classification
  // console.log('[CLASSIFY]', {
  //   baseType,
  //   scores,
  //   candidate,
  //   hasActivityCompletionStatus: !!r?.activityCompletionStatus,
  //   hasValidatedForms: Array.isArray(r?.validatedForms),
  //   hasFormData: !!r?.formData
  // });

  return candidate || 'other';
}

// Detect the "single object with arrays" pattern and return section candidates
export function splitIntoSections(rawResults: any, baseType?: string): { sections: Section[], primaryIdx: number } {
  const sections: Section[] = [];
  let primaryIdx = -1;

  // Case A: results is array of items
  if (Array.isArray(rawResults)) {
    const groups: Record<string, any[]> = {};
    for (const item of rawResults) {
      const t = classifyItemType(item, baseType);
      (groups[t] ||= []).push(item);
    }
    const order = Object.keys(groups);
    // Primary first if exists
    if (baseType && groups[baseType]) {
      sections.push({ type: baseType, items: groups[baseType] });
      primaryIdx = 0;
    }
    for (const k of order) {
      if (k === baseType) continue;
      sections.push({ type: k, items: groups[k] });
    }
    return { sections, primaryIdx };
  }

  // Case B: results is a single object with arrays
  const obj = isPlainObject(rawResults) ? rawResults : null;
  if (obj) {
    // Always include the parent object as the primary section (e.g., the AWH row itself)
    sections.push({ type: baseType || 'other', items: rawResults ? [rawResults] : [] });
    primaryIdx = 0;

    const keys = Object.keys(obj);
    const arrayKeys = keys.filter(k => Array.isArray((obj as any)[k]) && ((obj as any)[k].length > 0));
    // Prefer arrays with object-heavy content
    const goodKeys = arrayKeys.filter(k => {
      const arr: any[] = (obj as any)[k];
      const sample = arr.slice(0, Math.min(arr.length, 30));
      const objRatio = sample.filter(x => isPlainObject(x)).length / Math.max(sample.length, 1);
      return objRatio >= 0.3;
    });
    const keysToUse = goodKeys; // Only object-heavy arrays become sections

    const typeForKey = (k: string) => classifyByBase(k) || 'other';

    // Build sections. Merge all form-like arrays into a single "Forms" section with de-duplication.
    const formKeys = keysToUse.filter(k => typeForKey(k) === 'form');
    const otherKeys = keysToUse.filter(k => {
      const t = typeForKey(k);
      return t && t !== 'form' && t !== (baseType || 'other');
    });

    // 1) Forms: merge + deduplicate
    if (formKeys.length > 0) {
      const pool: any[] = [];
      for (const k of formKeys) {
        const arr = Array.isArray((obj as any)[k]) ? (obj as any)[k] : [];
        pool.push(...arr);
      }

      const seen = new Map<string, { item: any; score: number }>();
      const getId = (x: any): string | undefined => (
        x?.sourceMeta?.entities?.formId || x?.formId || x?._id || x?.form_ID || x?.Form_ID
      );
      const fallbackKey = (x: any): string | undefined => {
        const parts = [
          x?.submittedAt,
          x?.committedAt,
          x?.formTemplateID || x?.formTemplateId,
          x?.sourceMeta?.entities?.formTemplateId,
          x?.sourceMeta?.organizationID,
        ].filter(Boolean);
        return parts.length ? parts.join('|') : undefined;
      };
      const richnessScore = (x: any): number => (
        (x?.form ? 4 : 0) +
        (x?.sourceMeta?.entities?.formId ? 3 : 0) +
        (x?.templateSnapshot ? 2 : 0) +
        (x?.committedAt ? 1 : 0)
      );

      pool.forEach((x, idx) => {
        const key = getId(x) || fallbackKey(x) || `idx_${idx}`;
        const sc = richnessScore(x);
        const prev = seen.get(key);
        if (!prev || sc > prev.score) {
          seen.set(key, { item: x, score: sc });
        }
      });

      const deduped = Array.from(seen.values()).map(v => v.item);
      sections.push({ type: 'form', items: deduped });
    }

    // 2) Non-form arrays: as-is, provided they differ from the base type
    for (const k of otherKeys) {
      const items = Array.isArray((obj as any)[k]) ? (obj as any)[k] : [];
      const t = typeForKey(k);
      sections.push({ type: t, items });
    }

    return { sections, primaryIdx };
  }

  // Fallback
  sections.push({ type: baseType || 'other', items: rawResults ? [rawResults] : [] });
  primaryIdx = 0;
  return { sections, primaryIdx };
}

