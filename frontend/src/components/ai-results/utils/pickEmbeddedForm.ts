import { type FormDoc } from '../../forms/FormRenderer';

// Attempts to find a Form doc embedded in a Work History shape
export function pickEmbeddedForm(r: any): FormDoc | null {
  if (!r || typeof r !== 'object') return null;
  // Direct enriched body
  if (r.form && typeof r.form === 'object') return r.form;
  // Sometimes array of forms
  if (Array.isArray(r.forms) && r.forms.length && typeof r.forms[0] === 'object') return r.forms[0];
  // form_ID / forms_ID present but body not attached
  // if you wish, could return a stub with only _id, but renderer expects fields, so return null
  return null;
}

