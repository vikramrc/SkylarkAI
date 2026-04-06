export const ORGANIZATION_IDENTIFIER_QUERY_FIELDS = ["organizationShortName", "organizationName", "organizationID"];
export const VESSEL_IDENTIFIER_QUERY_FIELDS = ["vesselName", "vesselID"];

const mergeUnique = (...lists: string[][]) => [...new Set(lists.flat())];

const supportsOrganizationIdentifiers = (capability: any) => {
  const requiredQuery = capability.requiredQuery || [];
  const optionalQuery = capability.optionalQuery || [];
  return [requiredQuery, optionalQuery].some((fields) =>
    fields.includes("organizationID") ||
    fields.includes("organizationShortName") ||
    fields.includes("organizationName")
  );
};

const supportsVesselIdentifiers = (capability: any) => {
  const requiredQuery = capability.requiredQuery || [];
  const optionalQuery = capability.optionalQuery || [];
  return [requiredQuery, optionalQuery].some((fields) =>
    fields.includes("vesselID") || fields.includes("vesselName")
  );
};

export const normalizeCapabilityQueryFields = (capability: any) => {
  const requiredQuery = capability.requiredQuery || [];
  const optionalQuery = capability.optionalQuery || [];
  const supportsOrganization = supportsOrganizationIdentifiers(capability);
  const supportsVessel = supportsVesselIdentifiers(capability);

  return {
    ...capability,
    requiredQuery: requiredQuery.filter((field: string) => field !== "organizationID" && field !== "vesselID"),
    optionalQuery: mergeUnique(
      supportsOrganization ? ORGANIZATION_IDENTIFIER_QUERY_FIELDS : [],
      supportsVessel ? VESSEL_IDENTIFIER_QUERY_FIELDS : [],
      optionalQuery.filter((field: string) => field !== "organizationID" && field !== "vesselID")
    ),
  };
};

export function getParameterDescription(param: string, requiredFields: string[]) {
  const requiredLabel = requiredFields.includes(param) ? "Required" : "Optional";

  switch (param) {
    case "organizationShortName":
      return `${requiredLabel} friendly organization identifier. Prefer this when the user explicitly provides an org short name in their query. Alternative to organizationName or organizationID.`;
    case "organizationName":
      return `${requiredLabel} full organization name. Alternative to organizationShortName or organizationID.`;
    case "organizationID":
      return `${requiredLabel} canonical raw organization identifier. Not needed when organizationShortName or organizationName is already provided.`;
    case "vesselName":
      return `${requiredLabel} friendly vessel identifier within the resolved organization. Alternative to vesselID.`;
    case "vesselID":
      return `${requiredLabel} canonical raw vessel identifier. Not needed when vesselName is already provided.`;
    case "listPTWForms":
      return `${requiredLabel} flag. Set to true to filter forms submitted using a PTW design template type. DO NOT use this to search filled answer values. Use 'fieldNames' instead.`;
    case "ptwType":
      return `${requiredLabel} permit type enum filter (e.g., 'HOT_WORK', 'COLD_WORK', 'ENCLOSED_SPACE'). Use to filter PTW templates specific to that hazard profile type.`;
    case "listGlobalForms":
      return `${requiredLabel} flag. Set to true to filter for forms belonging to the Global Activity Mappings list in the UI (inclusive of Org-wide, Vessel-wide, and Schedule-wide template mappings).`;
    case "listNCForms":
      return `${requiredLabel} flag. Set to true to filter for forms submitted using a Non-Conformity response layout.`;
    case "listMandatoryIfOverdueForms":
      return `${requiredLabel} flag. Set to true to filter for forms tied to mandatory-upon-overdue schedules.`;
    case "fieldNames":
      return `${requiredLabel} parameter: accepts an array or set (e.g., comma-separated) of field names/labels to scan inside populated form answers. Use this to find forms where specific contents have been filled out and selected.`;
    case "isFailureEvent":
      return `${requiredLabel} flag. Set to true to filter for maintenance events that were specifically logged as failure-driven outcomes (unplanned/breakdown/CM).`;
    case "statusCode":
      return `${requiredLabel} status filter. Accepts a SINGLE value OR an ARRAY of values (comma-separated string or JSON array). Valid values: 'overdue', 'upcoming', 'completed', 'open', 'cancelled', 'rescheduled', 'missed'. Pass multiple values (e.g. ["cancelled", "missed", "rescheduled"]) to get combined results in one call. Note: 'cancelled', 'rescheduled', and 'missed' match on latestEventStatus and work in both query_status and query_execution_history.`;
    case "performedBy":
      return `${requiredLabel} performer search. Accepts a 24-character User ID, or a human-readable rank/designation (e.g., 'Chief Engineer', 'Third Officer'). Use to see who completed a task.`;
    case "majorJobsOnly":
      return `${requiredLabel} flag. Set to true to filter for high-impact maintenance events like Overhauls, Replacements, or Renewals.`;
    case "activityDescription":
      return `${requiredLabel} partial text match filter for the activity's name or description. Use this to find jobs related to specific equipment or actions if you don't have an ID.`;
    case "attachmentsOnly":
      return `${requiredLabel} evidence flag. Set to true to return only work history records that have uploaded files or manual attachments.`;
    case "partsUsedOnly":
      return `${requiredLabel} inventory flag. Set to true to return only work history records where spare parts consumption was logged.`;
    case "riskAssessmentOnly":
      return `${requiredLabel} safety flag. Set to true to return only records where a risk assessment was explicitly attached or filled.`;
    case "maintenanceType":
      return `${requiredLabel} category filter for the type of maintenance work (e.g., 'Preventative', 'Corrective'). ⚠️ ONLY provide this if the user explicitly named a maintenance type. DO NOT infer or default to 'Corrective' — omitting this parameter returns all types.`;
    case "searchTerm":
      return `${requiredLabel} CRITICAL parameter. The human-readable label or code to resolve (e.g., 'TESTCOSTCENTER1', 'Main Engine', 'John Doe'). YOU MUST ALWAYS PROVIDE THIS field, even if you are also providing organizationShortName or vesselName. The value you are searching for MUST go in this field.`;
    case "costCenterID":
    case "machineryID":
    case "scheduleID":
    case "activityID":
    case "vendorID":
    case "partID":
    case "locationID":
    case "templateID":
    case "workHistoryID":
    case "crewMemberID":
      return `${requiredLabel} canonical raw MongoDB ObjectId for the ${param.replace("ID", "")}. DO NOT guess this. If you only have a name (e.g., "JPY Budget", "Main Engine"), you MUST first use a broad query/overview tool (like budget.query_overview or fleet.query_machinery_status) to find the correct ID before calling this tool.`;
    case "fulfillmentFilter":
      return `${requiredLabel} filter for Purchase Order fulfillment status. Options: 'over50' (received > 50%), 'under50' (received < 50%), 'completed' (100% received), 'none' (0% received).`;
    default:
      return `${requiredLabel} parameter: ${param}`;
  }
}

function getIdentifierGuidance(capability: any) {
  const guidance = [];

  if (supportsOrganizationIdentifiers(capability)) {
    guidance.push(
      "Organization scope may be supplied with organizationShortName, organizationName, or organizationID. Prefer friendly organization identifiers when the user names the organization directly."
    );
  }

  if (supportsVesselIdentifiers(capability)) {
    guidance.push(
      "Vessel scope may be supplied with vesselName or vesselID. Prefer vesselName when the user names the vessel directly."
    );
  }

  return guidance.join(" ");
}

export function buildCapabilityDescription(capability: any) {
  const parts = [capability.purpose];

  if (capability.whenToUse) {
    parts.push(`When to use: ${capability.whenToUse}`);
  }

  if (capability.whenNotToUse) {
    parts.push(`DO NOT use: ${capability.whenNotToUse}`);
  }

  if (capability.typicalQuestions && capability.typicalQuestions.length > 0) {
    parts.push(`Typical questions: ${capability.typicalQuestions.map((q: string) => `"${q}"`).join(", ")}`);
  }

  const identifierGuidance = getIdentifierGuidance(capability);
  if (identifierGuidance) {
    parts.push(identifierGuidance);
  }

  return parts.join(" ");
}

export function buildCapabilityInputSchema(capability: any) {
  const normalizedCapability = normalizeCapabilityQueryFields(capability);
  const properties: Record<string, any> = {};
  const required = normalizedCapability.requiredQuery || [];

  mergeUnique(normalizedCapability.requiredQuery || [], normalizedCapability.optionalQuery || []).forEach((param) => {
    properties[param] = {
      type: "string",
      description: getParameterDescription(param, required),
    };
  });

  const inputSchema: Record<string, any> = {
    type: "object",
    properties,
    required,
  };

  const identifierGuidance = getIdentifierGuidance(normalizedCapability);
  if (identifierGuidance) {
    inputSchema.description = identifierGuidance;
  }

  return inputSchema;
}

const baseCapabilitiesContract = [
  {
    name: "mcp.health",
    method: "GET",
    path: "/api/mcp/health",
    requiredQuery: ["organizationID"],
    optionalQuery: [],
    purpose: "Health check for the isolated MCP layer.",
    whenToUse: "To minimally verify the MCP proxy is alive.",
    whenNotToUse: "Do not use to infer auth details or user roles; payload is intentionally minimized.",
    typicalQuestions: ["Is the MCP up?", "Is my auth token working?"],
    responseShape: ["ok", "service", "status"]
  },
  {
    name: "mcp.resolve_entities",
    method: "POST",
    path: "/api/mcp/resolve",
    requiredQuery: ["organizationID", "entityType", "searchTerm"],
    optionalQuery: ["vesselID", "organizationShortName", "organizationName", "vesselName"],
    purpose: "Resolves human-readable names or codes (e.g., 'Main Engine', 'CC-01', 'John Doe') into 24-character hexadecimal Mongo ObjectIds. This is the mandatory 'Discovery' tool to use whenever the user provides a label instead of an ID.",
    whenToUse: "Use this BEFORE calling any analytical or historical tool if you only have a name/code. Supported types: 'Vessel', 'Organization', 'Activity', 'ActivityWorkHistory', 'Machinery', 'Component', 'InventoryPart', 'InventoryLocation', 'MaintenanceSchedule', 'Vendor', 'CrewMember', 'FormTemplate', 'CostCenter', 'BudgetCode', 'Budget', 'PurchaseOrder', 'Invoice', 'PTW', 'DocumentMetadata', 'User'.",
    typicalQuestions: [
        "Find the ID for cost center CC-01", 
        "Who is designated as Chief Engineer?", 
        "Resolve 'Main Engine' to its machineryID", 
        "Find the ID for vessel XXX1",
        "What is the ID for the 'Aux Engine' maintenance schedule?",
        "Resolve the organization 'XXX1' to an ID."
    ],
    responseShape: ["capability", "appliedFilters", "items"]
  },
  {
    name: "mcp.capabilities",
    method: "GET",
    path: "/api/mcp/capabilities",
    requiredQuery: ["organizationID"],
    optionalQuery: [],
    purpose: "Lists currently available MCP business capabilities and detailed endpoint contracts.",
    whenToUse: "To retrieve the schema, definitions, and usage contexts of all AI tools in this layer.",
    typicalQuestions: ["What tools do you have?", "Which endpoints exist here?"],
    responseShape: ["service", "version", "organizationID", "capabilities"]
  },
  {
    name: "maintenance.query_status",
    method: "GET",
    path: "/api/mcp/maintenance/status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "vesselName", "scheduleID", "activityID", "activityWorkHistoryID", "tagName", "tagNames", "taggedOnly", "criticalOnly", "criticality", "department", "contractorRequired", "ptwRequired", "classCriticalOnly", "statutoryOnly", "statusCode", "hasInstructionsOnly", "isFailureEvent", "activityDescription", "startDate", "endDate", "limit"],
    purpose: "Returns overdue, upcoming, and recently completed maintenance work.",
    whenToUse: "When asked about overdue jobs, jobs due soon, what is pending, or checking schedule statuses. This is the primary tool for 'What is due/overdue' or 'Finding an activity ID'.",
    whenNotToUse: "Do NOT use for historical failure analysis (use reliability), deep execution comments, dedicated AWH queries (use execution_history), or technical instructions/manuals (use query_instructions). Do NOT use when the user asks 'who did' a job — performer data (performer name, man-hours, comments) only exists in execution_history.",
    typicalQuestions: [
      "Which activities are overdue?", 
      "What maintenance is due in the next 7 days?", 
      "Show me pending critical jobs.",
      "Show me completed maintenance from Jan 2026 to March 2026.",
      "What jobs are overdue from last year?",
      "Show me all cancelled jobs",
      "Show me rescheduled or missed maintenance"
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "statusCode accepts a SINGLE value OR an ARRAY (e.g. ['overdue','cancelled','missed']). Valid single values: overdue, upcoming, completed, open, cancelled, rescheduled, missed. Omit statusCode entirely to return all statuses. For 'who did it' (performer, man-hours, comments), use maintenance.query_execution_history instead."
  },
  {
    name: "maintenance.query_execution_history",
    method: "GET",
    path: "/api/mcp/maintenance/execution-history",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "scheduleID", "activityID", "activityWorkHistoryID", "tagName", "tagNames", "taggedOnly", "majorJobsOnly", "maintenanceType", "performedBy", "attachmentsOnly", "partsUsedOnly", "riskAssessmentOnly", "isFailureEvent", "statusCode", "startDate", "endDate", "limit"],
    purpose: "Returns recent maintenance execution events / Activity Work History (AWH), including completion status, costs, and comments.",
    whenToUse: "To see *how* a job was done, who did it, actual man-hours, comments logged, or parts consumed during execution. Use this for all Activity Work History (AWH) queries.",
    typicalQuestions: ["Who completed the lube oil change?", "What were the remarks on last month's overhaul?", "Show me tasks that required more man-hours than estimated.", "Show me the latest committed AWH.", "Show me lube oil levels logged between Jan 1st and Jan 31st.", "List work completed from 2026-01-01 to 2026-02-01.", "Show me the last overhaul date of the Air Compressor."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "statusCode accepts a SINGLE value OR an ARRAY (e.g. ['completed','cancelled','rescheduled','missed']). Valid single values: completed, cancelled, rescheduled, missed, created. Pass multiple values to get combined results in ONE tool call instead of calling the tool separately for each status. Use this tool when the user wants to know WHO performed a job (performer, man-hours, comments, parts used). ⚠️ DO NOT add `maintenanceType` (e.g., 'Corrective', 'Preventative') unless the user explicitly asks for a specific type — omitting it returns all types."
  },
  {
    name: "maintenance.query_compliance_overview",
    method: "GET",
    path: "/api/mcp/maintenance/compliance-overview",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "startDate", "endDate", "limit"],
    purpose: "Returns statutory and class-survey related maintenance status and risks.",
    whenToUse: "For any question relating to Port State Control (PSC), SOLAS, class inspections, or safety compliance.",
    typicalQuestions: ["Which vessels have overdue statutory surveys?", "Are any certificates at risk due to missed maintenance evidence?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Items flagged with 'isNonConformity' or 'classInspectionCompleted' are vital here."
  },
  {
    name: "maintenance.query_reliability",
    method: "GET",
    path: "/api/mcp/maintenance/reliability",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "severity", "startDate", "endDate", "limit"],
    purpose: "Returns failure counts, severity, repeat failures, and trend data.",
    whenToUse: "Use to investigate breakdowns, analyzing failures, reviewing failure causes, and tracking unplanned maintenance.",
    whenNotToUse: "Do NOT use for predicting future MTBF mathematically (use analytics.query_mtbf instead).",
    typicalQuestions: ["Which vessels report the highest breakdown maintenance?", "What were the major failures last month?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_operational_impact",
    method: "GET",
    path: "/api/mcp/maintenance/operational-impact",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "impactLevel", "startDate", "endDate", "limit"],
    purpose: "Returns downtime records and operational impact distribution.",
    whenToUse: "For questions about lost operational days, machinery downtime vs planned completion.",
    typicalQuestions: ["Which vessels lost the most operational days?", "Show me machinery downtime trends."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_spares_readiness",
    method: "GET",
    path: "/api/mcp/maintenance/spares-readiness",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "daysAhead", "limit"],
    purpose: "Returns required, available, and missing spare parts for upcoming planned maintenance.",
    whenToUse: "To check if a vessel has the inventory required to complete upcoming scheduled jobs.",
    whenNotToUse: "NOT for general stock balance queries (use inventory.query_stock_position).",
    typicalQuestions: ["Do we have the parts for next week's engine overhaul?", "Show me tasks blocked by missing spares."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Look at 'readinessStatus'. 'shortage' means parts are missing, 'ready' means all exact parts linked are available."
  },
  {
    name: "maintenance.query_schedules",
    method: "GET",
    path: "/api/mcp/maintenance/schedules",
    requiredQuery: ["organizationID", "vesselID"],
    optionalQuery: ["active", "limit"],
    purpose: "Lists maintenance schedules configured for a vessel.",
    whenToUse: "Use when the user first needs to identify which maintenance schedules exist for a vessel before drilling into machinery or activities.",
    typicalQuestions: ["What schedules exist for vessel X?", "Show me the active maintenance plan for this vessel."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "vessel", "items"],
    interpretationGuidance: "Use this as the first drill-down step. The returned scheduleID can be passed into the schedule-machinery and schedule-activities capabilities."
  },
  {
    name: "maintenance.query_schedule_machinery",
    method: "GET",
    path: "/api/mcp/maintenance/schedule-machinery",
    requiredQuery: ["organizationID", "scheduleID"],
    optionalQuery: ["limit"],
    purpose: "Lists machinery covered by a selected maintenance schedule.",
    whenToUse: "Use after selecting a schedule to understand which machinery items are included and how much activity/component coverage each has.",
    typicalQuestions: ["What machinery is included in this schedule?", "Show me the equipment covered by schedule ABC123."],
    responseShape: ["capability", "organizationID", "appliedFilters", "schedule", "vessel", "summary", "items"],
    interpretationGuidance: "Each item includes component and activity counts so the model can decide which machinery branch to drill into next."
  },
  {
    name: "maintenance.query_schedule_activities",
    method: "GET",
    path: "/api/mcp/maintenance/schedule-activities",
    requiredQuery: ["organizationID", "scheduleID", "machineryID"],
    optionalQuery: ["limit"],
    purpose: "Lists maintenance activities for a selected machinery item within a selected schedule.",
    whenToUse: "Use after selecting both a schedule and a machinery item to inspect the concrete tasks, intervals, and execution requirements.",
    typicalQuestions: ["What activities exist for this machinery in the selected schedule?", "Show me the jobs under purifier maintenance schedule ABC123."],
    responseShape: ["capability", "organizationID", "appliedFilters", "schedule", "vessel", "machinery", "components", "summary", "items"],
    interpretationGuidance: "This is the deepest deterministic drill-down in the schedule hierarchy and is the right capability for enumerating jobs rather than overall schedule status."
  },
  {
    name: "crew.query_readiness",
    method: "GET",
    path: "/api/mcp/crew/readiness",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "limit"],
    purpose: "Returns crew readiness including active assignments and expiring certificates/documents.",
    whenToUse: "To evaluate if crew members lack required certifications or have expiring travel documents.",
    typicalQuestions: ["Are there any missing compliance certificates on vessel X?", "Who has an expiring medical certificate?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "crew.query_workload",
    method: "GET",
    path: "/api/mcp/crew/workload",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "limit"],
    purpose: "Returns planned and active crew workload and assignments.",
    whenToUse: "When asked about manpower distribution, man-hours per rank, or if a vessel is under-resourced.",
    typicalQuestions: ["How many man-hours per rank are being consumed?", "Are any vessels under-resourced for critical maintenance?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "documents.query_search",
    method: "GET",
    path: "/api/mcp/documents/search",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "searchTerm", "type", "sfiCode", "limit"],
    purpose: "Searches documents by metadata, name, type, and SFI code.",
    whenToUse: "To find manuals, drawings, procedures, or missing technical evidence.",
    typicalQuestions: ["Which maintenance jobs lack supporting procedures?", "Find the pump manual for SFI 701."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "documents.query_control_overview",
    method: "GET",
    path: "/api/mcp/documents/control-overview",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "status", "days", "startDate", "endDate", "limit"],
    purpose: "Returns document control overview including latest versions and approval statuses. Supports expiry-aware certificate queries directly through the MCP endpoint when `status=expired` or `status=expiring` is supplied.",
    whenToUse: "For finding outdated manuals, unapproved revisions, checking document tags, or answering expired/expiring certificate questions.",
    typicalQuestions: ["Show me documents tagged as 'temporary instructions'.", "Are outdated manuals being used?", "Show me expired certificates/documents.", "Which certificates are expiring soon?", "Which certificates expired this year?", "Show me certificates expiring between Jan and March 2026."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "forms.query_status",
    method: "GET",
    path: "/api/mcp/forms/status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "templateID", "status", "listGlobalForms", "listPTWForms", "listNCForms", "listMandatoryIfOverdueForms", "ptwType", "vesselSpecificOnly", "isAdhoc", "startDate", "endDate", "limit"],
    purpose: "Returns due, overdue, submitted, and committed forms.",
    whenToUse: "Tracking formal checklist/form submissions required for compliance or operations.",
    typicalQuestions: ["Are there missing checklists for departure?", "Show me rejected safety forms.", "Show me forms submitted last month.", "Which forms were committed between January and February 2026?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "forms.query_contents",
    method: "GET",
    path: "/api/mcp/forms/contents",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "formId", "templateName", "activityWorkHistoryID", "onlyWithJobContext", "status", "listGlobalForms", "listPTWForms", "listNCForms", "listMandatoryIfOverdueForms", "ptwType", "fieldNames", "vesselSpecificOnly", "isAdhoc", "startDate", "endDate", "limit"],
    purpose: "Returns full form submission answers with resolved question labels, field values, attachment filenames, and DMS document references.",
    whenToUse: "Use when the user wants to read what was actually submitted in a form — the question-answer pairs, uploaded file names, or linked DMS documents. Accepts either a direct formId, templateName, or activityWorkHistoryID. Pass onlyWithJobContext=true to find all forms specifically tied to *any* job. If templateName is provided, the tool resolves all matching submissions automatically. If activityWorkHistoryID is provided, it returns all forms filled out for that specific work history task. Use fieldNames to filter templates that contain specific field labels (e.g., fieldNames='PTW' finds forms with a field labelled 'PTW Checklist'). Supports array or comma-separated lists of names. DO NOT use listPTWForms or listNCForms to search inside filled contents; they are purely template metadata filters. For all forms returned, it also enriches with full Activity Work History summary details if available.",
    whenNotToUse: "Do NOT use for high-level listing or counting form submissions (use forms.query_status instead). **Do NOT use when the user primarily wants to inspect full Activity Work History execution events, man-hours, or maintenance comments alone (use `maintenance.query_execution_history` instead)**.",
    typicalQuestions: ["What did they say in the Risk Form?", "Show me attached files for form 123", "What answers were logged for task 456?", "What did the crew fill out in forms submitted last week?", "Show me safety checklist answers from Jan 2026."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "ptw.query_pipeline",
    method: "GET",
    path: "/api/mcp/ptw/pipeline",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "status", "type", "approvalStatus", "rejectedOnly", "documentsOnly", "riskAssessmentOnly", "startDate", "endDate", "limit"],
    purpose: "Returns pending, active, expiring soon, and closed permits to work.",
    whenToUse: "To verify safe isolation status or see what hazardous work is actively permitted.",
    typicalQuestions: ["Show me open hot work permits.", "Are there any PTWs expiring in the next hour?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "budget.query_overview",
    method: "GET",
    path: "/api/mcp/budget/overview",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "year", "department", "limit"],
    purpose: "Returns budget allocations vs actuals and commitments.",
    whenToUse: "High-level financial summaries, spotting cost overruns, or comparing labor vs spares budgets.",
    typicalQuestions: ["What is the total maintenance cost per vessel?", "Show me cost overruns for the last dry dock."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "budget.query_cost_analysis",
    method: "GET",
    path: "/api/mcp/budget/cost-analysis",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "costCenterID", "referenceType", "transactionType", "limit"],
    purpose: "Returns detailed cost transactions and granular invoice data.",
    whenToUse: "Deep diving into specific spend, transaction matching, comparing exact cost centers.",
    typicalQuestions: ["Which machinery types consume the highest share of the budget?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "procurement.query_vendor_performance",
    method: "GET",
    path: "/api/mcp/procurement/vendor-performance",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vendorID", "startDate", "endDate", "limit"],
    purpose: "Returns vendor performance metrics including lead times, on-time delivery rates, and quality flags.",
    whenToUse: "To answer questions about late deliveries, vendor quality, or emergency order sourcing.",
    typicalQuestions: ["Which vendors consistently deliver late?", "What percentage of delivered parts failed quality checks?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "fleet.query_overview",
    method: "GET",
    path: "/api/mcp/fleet/overview",
    requiredQuery: ["organizationID"],
    optionalQuery: ["startDate", "endDate", "limit"],
    // 🧭 DISCOVERY TOOL: Primary role is entity resolution (vessel IDs), not final data delivery.
    purpose: "DISCOVERY TOOL — Returns the list of fleet vessels and their high-level maintenance KPIs (overdue counts, completion stats). Primary role in org-wide investigations is to resolve all active vessel IDs so they can be passed to per-vessel retrieval tools. Secondary role is executive dashboarding.",
    whenToUse: "1. As the mandatory first step in any org-wide or fleet-wide investigation (e.g. 'show me cancelled jobs for the whole fleet') — extract the vessel IDs from the result and pass them to maintenance.query_execution_history or maintenance.query_status in the following turn. 2. When the user explicitly asks for a high-level fleet overview or KPI dashboard.",
    whenNotToUse: "DO NOT treat the KPI counts (overdue counts, completion stats) returned by this tool as the detailed data the user asked for. These are summary indicators only — they do NOT contain job details, performer information, or execution records. After running this tool in an org-wide investigation, you MUST call a retrieval tool (e.g. maintenance.query_execution_history) using the vessel IDs from this result.",
    typicalQuestions: ["Which vessels consistently exceed fleet averages for PMS compliance?", "Give me a fleet summary.", "Show me org-wide cancelled jobs across all vessels.", "Which vessel has the most overdue jobs?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "items[n]._id is the canonical vesselID for that vessel. In an org-wide investigation, ALWAYS extract these IDs and pass them to per-vessel tools such as maintenance.query_execution_history (with vesselID parameter) to retrieve actual job-level data. KPI counts (overdue, upcoming, completedInRange) are navigational signals — not job execution records."
  },
  {
    name: "fleet.query_machinery_status",
    method: "GET",
    path: "/api/mcp/fleet/machinery-status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "criticalOnly", "searchTerm", "limit"],
    purpose: "Returns machinery list with running hours, pending activities, and overdue counts.",
    whenToUse: "To evaluate specific equipment condition, alarms, or drill down into one vessel's engine room.",
    typicalQuestions: ["Show me machinery pushing past thresholds.", "Which critical alarms are linked to overdue tasks?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "fleet.query_running_hours",
    method: "GET",
    path: "/api/mcp/fleet/running-hours",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "machineryID", "days", "startDate", "endDate", "limit"],
    purpose: "Returns daily machinery running hours log with totals and averages.",
    whenToUse: "To track machinery usage rates, condition monitoring trends, or verify operation logs.",
    typicalQuestions: ["Show me the running hours for the Aux Engines.", "Show me condition monitoring trends.", "Show me running hours logged in Q1 2026.", "What was the total running hours in January?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Defaults to latest available hours if an explicit days window returns empty."
  },
  {
    name: "inventory.query_consumption_analysis",
    method: "GET",
    path: "/api/mcp/inventory/consumption-analysis",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "partID", "transactionType", "days", "startDate", "endDate", "limit"],
    purpose: "Returns parts consumption history, issue, transfer, and receipt trends.",
    whenToUse: "Analyzing exactly *where* and *how fast* parts are being used/transferred.",
    typicalQuestions: ["Which items are issued above average trend?", "Which spares are frequently transferred between vessels?", "How many spares were issued in Jan 2026?", "Show me consumption rates from last month."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_reminder_tracking",
    method: "GET",
    path: "/api/mcp/maintenance/reminder-tracking",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "active", "limit"],
    purpose: "Returns job reminders sent, pre-due alerts, and tracking state.",
    whenToUse: "Auditing if the crew was warned about an upcoming/overdue job.",
    typicalQuestions: ["Were reminders sent for the overlooked dry-dock items?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_deferred_analysis",
    method: "GET",
    path: "/api/mcp/maintenance/deferred-analysis",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "scheduleID", "activityID", "startDate", "endDate", "limit"],
    purpose: "Returns jobs that were completed significantly after their planned due date or are repeatedly deferred.",
    whenToUse: "Root cause analysis for constant delays.",
    typicalQuestions: ["Which activities are frequently deferred?", "Show me unplanned costs caused by deferred tasks."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "procurement.query_orders_summary",
    method: "GET",
    path: "/api/mcp/procurement/orders-summary",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "vesselName", "vesselLinkedOnly", "status", "urgency", "days", "startDate", "endDate", "searchTerm", "leadTimeExceptionOnly", "fulfillmentFilter", "fulfillmentPercent", "fulfillmentPercentOperator", "limit"],
    purpose: "Returns PO details with line items, urgency, fulfillment metrics (totalOrderedQty, totalReceivedQty, fulfillmentPercent), and delivery status. Supports vesselLinkedOnly=true to strictly filter for ship-specific procurement and exclude organization-wide or shore-side entries.",
    whenToUse: "Tracking order status, checking emergency orders, analyzing fulfillment-based procurement performance, or when the user asks for POs linked to ships/vessels only.",
    typicalQuestions: ["Show me emergency orders raised outside vendor lists.", "Are there POs stuck in transit?", "Show me POs for any vessel.", "Only show POs associated with ships.", "Show me POs raised last month.", "Which orders are expected to deliver between Jan and Feb 2026?", "Show me sent POs which are over 30% fulfilled.", "List POs with less than 50% fulfillment."],
    interpretationGuidance: "For fulfillment queries, pass the raw number (e.g., 30) to fulfillmentPercent. ALWAYS pass a valid MongoDB comparison operator (gte, gt, lte, lt) to fulfillmentPercentOperator. Default to gte if the user says 'at least' or 'over'.",
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "procurement.query_invoice_logistics_returns",
    method: "GET",
    path: "/api/mcp/procurement/invoice-logistics-returns",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "invoiceStatus", "landingStatus", "returnStatus", "startDate", "endDate", "searchTerm", "limit"],
    purpose: "Integrated view of invoices, landing orders, and return orders.",
    whenToUse: "Correlating the end of the supply chain—shipping, port landings, returns, and invoice matching.",
    whenNotToUse: "Not meant to guarantee exact 1:1 linkage if schemas do not support it; provides side-by-side visibility.",
    typicalQuestions: ["Which invoices are mismatched with landed goods?", "Show me returns tracking."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "recent", "signals"]
  },
  {
    name: "budget.query_invoice_status",
    method: "GET",
    path: "/api/mcp/budget/invoice-status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "status", "startDate", "endDate", "limit"],
    purpose: "Returns invoices breakdown with pending, approved, settled, and overdue status.",
    whenToUse: "Tracking supplier payments or invoice processing delays.",
    typicalQuestions: ["Are there overdue invoices for Vendor X?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "crew.query_compliance",
    method: "GET",
    path: "/api/mcp/crew/compliance",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "crewMemberID", "days", "startDate", "endDate", "limit"],
    purpose: "Returns work/rest records, fatigue risk indicators, and compliance violations.",
    whenToUse: "Auditing strict MLC Work/Rest Hours violations or crew fatigue.",
    typicalQuestions: ["Show me crew members logging excessive hours or work/rest violations.", "Show me fatigue violations logged last month.", "Are there rest hour violations from Jan 2026?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "crew.query_members",
    method: "GET",
    path: "/api/mcp/crew/members",
    requiredQuery: ["organizationID"],
    optionalQuery: ["crewMemberIDs", "vesselID", "limit"],
    purpose: "Returns non-PII metadata (Rank, Department) for crew members to enable anonymized reporting.",
    whenToUse: "Use this to resolve performer IDs into their functional roles/ranks for 'Anonymized Profile' requests. Specifically useful when IDs are returned from other maintenance or procurement tools and you need to show 'who' they are by rank instead of name.",
    typicalQuestions: ["What are the ranks of the crew who did these jobs?", "Show me the roles for these performer IDs."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Items return crewMemberID, designation (Rank), and department. Names/Emails are strictly excluded for privacy."
  },
  {
    name: "fleet.query_structures",
    method: "GET",
    path: "/api/mcp/fleet/structures",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "type", "limit"],
    purpose: "Returns structural metadata including SFI hierarchy and Component trees.",
    whenToUse: "Any query requesting 'SFI', 'Systems', 'Component Tree', or machinery hierarchy context.",
    typicalQuestions: ["Show me the structure of the Main Engine.", "List all SFI 700 components."],
    responseShape: ["capability", "organizationID", "appliedFilters", "sfi", "components"],
    itemShapeNotes: "Components are correctly scoped by org/vessel associations."
  },
  {
    name: "search.query_metadata",
    method: "GET",
    path: "/api/mcp/search/metadata",
    requiredQuery: ["organizationID"],
    optionalQuery: ["limit"],
    purpose: "Returns global saved searches and searchable tag definitions.",
    whenToUse: "To understand how users tag data or to leverage pre-existing user search scopes.",
    typicalQuestions: ["What tags do we use for safety? Context menu searches."],
    responseShape: ["capability", "organizationID", "savedSearches", "tags"]
  },
  {
    name: "crew.query_competency_config",
    method: "GET",
    path: "/api/mcp/crew/competency-config",
    requiredQuery: ["organizationID"],
    optionalQuery: ["limit"],
    purpose: "Returns competency signal configurations and requirement mappings.",
    whenToUse: "Understanding *what* certificates are actually demanded per rank/vessel.",
    typicalQuestions: ["What is required for a 3rd Engineer?"],
    responseShape: ["capability", "organizationID", "signals"]
  },
  {
    name: "analytics.query_mtbf",
    method: "GET",
    path: "/api/mcp/analytics/mtbf",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "machineryID", "startDate", "endDate", "limit"],
    purpose: "Returns mean time between failures and aggregated failure counts per machinery.",
    whenToUse: "Directly tackling MTBF mathematical questions and failure cluster analysis.",
    typicalQuestions: ["What are the average running hours between failures for auxiliary engines?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "inventory.query_dead_stock",
    method: "GET",
    path: "/api/mcp/inventory/dead-stock",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "months", "limit"],
    purpose: "Returns inventory items with zero transactions in the past specified months.",
    whenToUse: "To find obsolete or unused stock holding up capital.",
    typicalQuestions: ["What is the dead stock value (no movement in 24 months) across warehouses?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Provides a true cross-reference between Stock Locations and zero Transaction existence."
  },
  {
    name: "inventory.query_cost_escalation",
    method: "GET",
    path: "/api/mcp/inventory/cost-escalation",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "startDate", "endDate", "limit"],
    purpose: "Returns parts sorted by highest historical cost escalation percentage over their transaction history.",
    whenToUse: "Procurement price audits or inflation checking.",
    typicalQuestions: ["Which parts experienced the highest cost escalation compared to last year?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "items"]
  },
  {
    name: "maintenance.query_quality_assurance",
    method: "GET",
    path: "/api/mcp/maintenance/quality-assurance",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "startDate", "endDate", "limit"],
    purpose: "Returns completed maintenance jobs flagged for missing evidence, remarks, or procedures.",
    whenToUse: "Checking if crew is 'pencil whipping' maintenance forms.",
    typicalQuestions: ["Which critical activities were completed without attaching evidence?", "What percentage of jobs closed without remarks?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "inventory.query_stock_position",
    method: "GET",
    path: "/api/mcp/inventory/stock-position",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "machineryID", "partID", "locationID", "category", "criticalOnly", "lowStockOnly", "limit"],
    purpose: "Returns stock position, availability, reorder risk, and location mappings.",
    whenToUse: "General stock level checks, shortages, reorder levels. Also use machineryID to find available spares compatible with a specific equipment.",
    typicalQuestions: ["Show me parts with repeated stock-outs.", "Where is the main engine piston?", "What spares are available for the Main Engine?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_instructions",
    method: "GET",
    path: "/api/mcp/maintenance/instructions",
    requiredQuery: ["organizationID"],
    optionalQuery: ["activityID", "vesselID", "hasInstructionsOnly", "limit"],
    purpose: "Returns the detailed html notes and document attachments containing maintenance instructions for a specific activity. Can also be used to discover activities that strictly have instructions.",
    whenToUse: "Use this ONLY when the user asks for 'instructions', 'manuals', 'notes', 'steps', or 'how to'. To find non-blank instructions, pass hasInstructionsOnly=true without an activityID. **Definitive Result**: If this tool returns zero items for a given scope, it means NO instructions exist in the system for that scope. DO NOT fall back to other tools or direct queries.",
    whenNotToUse: "Do NOT use this to check schedules, due dates, or general status. Do NOT use if you need a list of activities (use query_status first to find the activity ID).",
    typicalQuestions: ["How do I perform the 2000hrs overhaul?", "Show me the instructions for this purifier maintenance.", "Are there maker instructions attached to this job?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "inventory.query_expiries",
    method: "GET",
    path: "/api/mcp/inventory/expiries",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "type", "days", "limit"],
    purpose: "Returns inventory items that possess expiration dates or calibration due dates nearing in the defined lookahead days.",
    whenToUse: "When explicitly tracking expiring chemicals, medical stores, lube oils, or gauges due for calibration.",
    typicalQuestions: ["Which items in the inventory are nearing expiry?", "Are there any gauges due for calibration in the next 30 days?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Set 'type' to either 'expiry' or 'calibration'."
  },
  {
    name: "procurement.query_pipeline_state",
    method: "GET",
    path: "/api/mcp/procurement/pipeline-state",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "vendorID", "limit"],
    purpose: "Returns RFQ, PO, replenish, landing, and return pipeline summaries.",
    whenToUse: "General procurement cycle visibility.",
    typicalQuestions: ["Show me procurement cycle time trends from request to delivery."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "recent", "alerts"]
  },

  // ── Gap-fill Batch 6 ──────────────────────────────────────────────────────────
  {
    name: "inventory.query_transactions",
    method: "GET",
    path: "/api/mcp/inventory/transactions",
    requiredQuery: ["organizationID"],
    optionalQuery: ["transactionType", "vesselID", "partID", "days", "startDate", "endDate", "limit"],
    purpose: "Returns inventory transaction history across receipt, issue, transfer, return, and return_to_vendor states.",
    whenToUse: "Use this for transaction-specific inventory questions like issued parts, returned-to-vendor parts, receipts, transfers, or general inventory movements.",
    whenNotToUse: "Not for current stock balance snapshots (use inventory.query_stock_position), dead stock detection, or overstock analysis.",
    typicalQuestions: [
      "Show me the issued parts.",
      "What parts were returned to vendor?",
      "Show recent inventory transfers.",
      "Show all inventory transactions for this vessel.",
      "List receipts recorded between Jan 2026 and March 2026.",
      "Show me stock transfers from last month.",
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "If transactionType is omitted, items may include mixed transaction states. Use summary.byTransactionType to understand the distribution across receipt, issue, transfer, return, and return_to_vendor."
  },
  {
    name: "inventory.query_stock_transfers",
    method: "GET",
    path: "/api/mcp/inventory/stock-transfers",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "fromVesselID", "toVesselID", "partID", "status", "days", "startDate", "endDate", "limit"],
    purpose: "Returns cross-vessel spare parts transfer transactions within the lookback window.",
    whenToUse: "To investigate which spares are frequently moved between vessels, or to check if a part was transferred away from a vessel that now needs it.",
    whenNotToUse: "Not for general stock level queries (use inventory.query_stock_position). Not for issue/receipt transactions (use inventory.query_consumption_analysis).",
    typicalQuestions: [
      "Which spares are being frequently transferred between vessels?",
      "Was any part sent from MV Atlantic to another vessel last month?",
      "Show me cross-fleet spare movements in the last 90 days.",
      "List transfers recorded between Jan 2026 and Feb 2026.",
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Each item shows the fromVessel and toVessel context. A high transfer frequency for a part across vessels may indicate imbalanced centralized stocking."
  },
  {
    name: "inventory.query_excess_stock",
    method: "GET",
    path: "/api/mcp/inventory/excess-stock",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "limit"],
    purpose: "Returns inventory items where current stock exceeds their configured maxStockLevel, with estimated capital tied up.",
    whenToUse: "To find parts that are overstocked, tying up capital or warehouse space.",
    whenNotToUse: "Not for items without a maxStockLevel configured (they won't appear). Not for generalized stock reports.",
    typicalQuestions: [
      "Which items are overstocked and tying up money?",
      "Show me parts above their maximum stock level.",
      "What inventory capital can we free up?"
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "summary.estimatedExcessValue gives the total monetary value of excess stock. Items have excessQuantity showing how far above maxStockLevel they are."
  },
  {
    name: "procurement.query_replenish_orders",
    method: "GET",
    path: "/api/mcp/procurement/replenish-orders",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "status", "criticalOnly", "openGapOnly", "documentsOnly", "partSearchTerm", "startDate", "endDate", "limit"],
    purpose: "Returns replenish (stock request) orders with vessel, part, and status context.",
    whenToUse: "When specifically asked about stock replenishment requests, open requisitions, or orders that have been raised to re-stock parts.",
    whenNotToUse: "For full PO pipeline use procurement.query_pipeline_state or procurement.query_orders_summary instead.",
    typicalQuestions: [
      "Show me all open requisitions for spare parts.",
      "Which replenish orders are stuck and not moving?",
      "What replenishment requests have been raised this week?"
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "summary.byStatus shows the count and total quantity by status (e.g. pending, converted, closed). Filter by status=pending for actionable open items."
  },
  {
    name: "analytics.query_mttr",
    method: "GET",
    path: "/api/mcp/analytics/mttr",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "searchTerm", "startDate", "endDate", "limit"],
    purpose: "Returns Mean Time To Repair (MTTR) calculated from failure events to committed completion, grouped by machinery.",
    whenToUse: "When explicitly asked about MTTR, repair speed, how long it takes to recover from a breakdown, or to compare repair efficiency across machinery types.",
    whenNotToUse: "Not for MTBF (use analytics.query_mtbf). Not for general failure lists (use maintenance.query_reliability).",
    typicalQuestions: [
      "What is the MTTR for the main engine fuel pumps?",
      "Which machinery takes the longest to repair after failure?",
      "Show me average repair times by equipment."
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "avgRepairHours is calculated from plannedDueDate (or previousDueDate) of the failure work history to the latestEventDate when the job was committed. Higher avgRepairHours = slower repair recovery."
  },
  {
    name: "maintenance.query_condition_monitoring",
    method: "GET",
    path: "/api/mcp/maintenance/condition-monitoring",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "machineryID", "days", "startDate", "endDate", "searchTerm", "limit"],
    purpose: "Returns daily running hours trends per machinery, aggregated to show avg, min, max, and total usage over the lookback window.",
    whenToUse: "When asked about running hours trends, condition-based maintenance indicators, or which machinery is being operated most intensively.",
    whenNotToUse: "Does not include sensor readings, vibration, or temperature data (those are outside the current MCP model). Use analytics.query_mtbf for failure frequency.",
    typicalQuestions: [
      "Show me condition monitoring trends for propulsion machinery.",
      "Which machinery show abnormal running hours this month?",
      "Show me the running hours for the Aux Engines over the last 30 days.",
      "Show me condition monitoring logging trend from last month.",
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "High avgDailyRunningHours relative to fleet norms may indicate over-reliance on particular machinery. maxDailyRunningHours vs minDailyRunningHours spread reveals load variability."
  },
  {
    name: "ptw.query_approval_stats",
    method: "GET",
    path: "/api/mcp/ptw/approval-stats",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "days", "startDate", "endDate", "status", "type", "approvalStatus", "rejectedOnly", "documentsOnly", "riskAssessmentOnly", "limit"],
    purpose: "Returns PTW status breakdown and approval count metrics for a given period.",
    whenToUse: "When asked about PTW approval rates, how many permits were rejected, or how many approvals a typical permit requires.",
    whenNotToUse: "For open active permits use ptw.query_pipeline instead.",
    typicalQuestions: [
      "What is the average approval time for PTWs this month?",
      "Which vessel has the highest number of rejected permits?",
      "How many hot work permits were approved vs rejected?",
      "What is the approval rate for permits raised last month?",
      "Show me rejections from Jan 2026.",
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "summary.byStatus.rejected.count shows rejected PTWs. avgApprovals per status shows the workflow depth. High approval counts may indicate inefficient permit workflows."
  },
  {
    name: "fleet.query_risk_summary",
    method: "GET",
    path: "/api/mcp/fleet/risk-summary",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "limit"],
    purpose: "Returns a risk-ranked summary of all fleet vessels, combining overdue maintenance, failure events, and crew certificate expiry into a composite riskScore.",
    whenToUse: "The most direct endpoint for 'superintendent briefing' type questions, fleet-wide risk overview, or 'what should I escalate to shore management today' queries.",
    whenNotToUse: "Not for single-vessel deep dives (use fleet.query_overview or fleet.query_machinery_status). Not for financial risk.",
    typicalQuestions: [
      "If I had to brief the superintendent in five minutes, what are the biggest maintenance and crew issues right now?",
      "Which vessels are at highest maintenance risk today?",
      "Show me a quick fleet risk ranking."
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "riskScore is a weighted composite: overdueJobs × 2 + failureEvents × 3 + expiringCerts × 1. summary.highRiskVessels shows count above score threshold 20. Sort by riskScore desc for highest-risk first."
  }
];

export const capabilitiesContract = baseCapabilitiesContract.map(normalizeCapabilityQueryFields);

export const capabilitiesContractDocs = {
  service: "PhoenixCloud MCP",
  version: "0.1.0",
  authExpectations: "Token-based. For organization-scoped routes, provide one of organizationShortName, organizationName, or organizationID; prefer friendly organization identifiers when the user gives a name. Wherever vesselID is accepted, vesselName is also accepted within the resolved organization and should be preferred when the user gives a vessel name.",
  generalGuidance: "Direct Mongoose reads. Do NOT infer fake cross-org relationships. Use composed queries for complex data points.",
  emptyResultInterpretation: "An empty 'items' array means no documents matched the applied tenant/filter query. During MCP validation, treat empties as needing direct DB confirmation before accepting them as truly empty.",
  capabilities: capabilitiesContract
};
