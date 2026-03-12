/**
 * Dual-View Transformation Utilities
 * 
 * Transforms data between different collection views when dual-view toggle is active.
 * Pattern: Forms ↔ AWH, Documents ↔ AWH, etc.
 */

/**
 * Transform Forms results to AWH-grouped results
 * Groups multiple forms by their activityWorkHistory_ID
 */
export function transformFormsToAWH(formResults: any[]): any[] {
  if (!Array.isArray(formResults) || formResults.length === 0) {
    return [];
  }

  // Group forms by activityWorkHistory_ID
  const grouped: Record<string, any> = {};

  formResults.forEach((form) => {
    const awhId = form.activityWorkHistory_ID || form.activityWorkHistoryID;
    if (!awhId) return; // Skip forms without AWH link

    if (!grouped[awhId]) {
      // Create AWH-like structure from first form
      grouped[awhId] = {
        // Core IDs
        activityWorkHistory_ID: awhId,
        activityMapping_ID: form.activityMapping_ID,
        vessel_ID: form.vessel_ID,
        organization_ID: form.organization_ID,

        // Enriched fields (from enrichment)
        machinery_ID: form.machinery_ID,
        component_ID: form.component_ID,
        activity_ID: form.activity_ID,

        // Timestamps
        committedAt: form.committedAt || form.effectiveCompletedAt,
        effectiveCompletedAt: form.effectiveCompletedAt,
        submittedAt: form.submittedAt,

        // Status
        status: form.status,
        committed: form.status === 'committed',
        active: form.active,

        // AWH-specific flags
        awh_hasForms: true,
        awh_hasAttachments: form.awh_hasAttachments || false,

        // Store form references
        formIds: [],
        forms: [],
        formCount: 0,

        // Copy sourceMeta (use first form's)
        sourceMeta: form.sourceMeta,

        // Mark as transformed
        _transformedFrom: 'forms',
      };
    }

    // Add this form to the group
    grouped[awhId].formIds.push(form.forms_ID || form.formId);
    grouped[awhId].forms.push(form);
    grouped[awhId].formCount = grouped[awhId].forms.length;

    // Update timestamps to latest
    if (form.committedAt && (!grouped[awhId].committedAt || form.committedAt > grouped[awhId].committedAt)) {
      grouped[awhId].committedAt = form.committedAt;
    }
  });

  return Object.values(grouped);
}

/**
 * Transform AWH results to Forms (flatten)
 * Expands AWH records that have embedded forms
 */
export function transformAWHToForms(awhResults: any[]): any[] {
  if (!Array.isArray(awhResults) || awhResults.length === 0) {
    return [];
  }

  const forms: any[] = [];

  awhResults.forEach((awh) => {
    if (awh.forms && Array.isArray(awh.forms) && awh.forms.length > 0) {
      // AWH has embedded forms - expand them
      forms.push(...awh.forms);
    } else if (awh._transformedFrom === 'forms' && awh.formIds?.length > 0) {
      // This AWH was created from forms transformation
      // We have the original forms stored
      forms.push(...awh.forms);
    }
  });

  return forms;
}

/**
 * Get the appropriate renderer type based on active view
 */
export function getRendererForView(
  activeView: string,
  originalCollection: string
): string {
  // Map view IDs to renderer types
  const viewToRenderer: Record<string, string> = {
    forms: 'form',
    activityWorkHistory: 'work_history',
    documents: 'document',
    inventoryUsage: 'inventory_usage',
  };

  return viewToRenderer[activeView] || originalCollection;
}

/**
 * Transform results based on active view selection
 */
export function transformResultsForView(
  results: any[],
  activeView: string,
  originalCollection: string
): any[] {
  // No transformation needed if viewing original collection
  if (activeView === originalCollection) {
    return results;
  }

  // Forms → AWH
  if (originalCollection === 'forms' && activeView === 'activityWorkHistory') {
    return transformFormsToAWH(results);
  }

  // AWH → Forms
  if (originalCollection === 'activityWorkHistory' && activeView === 'forms') {
    return transformAWHToForms(results);
  }

  // Future patterns:
  // Documents → AWH
  // InventoryTransaction → AWH
  // etc.

  // Default: return original results
  return results;
}

