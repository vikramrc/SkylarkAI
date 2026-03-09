export const capabilitiesContract = [
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
    optionalQuery: ["vesselID", "scheduleID", "activityID", "criticalOnly", "statusCode", "limit"],
    purpose: "Returns overdue, upcoming, and recently completed maintenance work.",
    whenToUse: "When asked about overdue jobs, jobs due soon, what is pending, or checking schedule statuses.",
    whenNotToUse: "Do NOT use for historical failure analysis (use reliability) or deep execution comments (use execution_history).",
    typicalQuestions: [
      "Which activities are overdue?", 
      "What maintenance is due in the next 7 days?", 
      "Show me pending critical jobs."
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Filter by statusCode=overdue or statusCode=upcoming. The 'summary' block provides quick counts."
  },
  {
    name: "maintenance.query_execution_history",
    method: "GET",
    path: "/api/mcp/maintenance/execution-history",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "scheduleID", "activityID", "limit"],
    purpose: "Returns recent maintenance execution events, completion status, costs, and comments.",
    whenToUse: "To see *how* a job was done, who did it, actual man-hours, comments logged, or parts consumed during execution.",
    typicalQuestions: ["Who completed the lube oil change?", "What were the remarks on last month's overhaul?", "Show me tasks that required more man-hours than estimated."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "maintenance.query_compliance_overview",
    method: "GET",
    path: "/api/mcp/maintenance/compliance-overview",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "limit"],
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
    optionalQuery: ["vesselID", "severity", "limit"],
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
    optionalQuery: ["vesselID", "impactLevel", "limit"],
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
    optionalQuery: ["vesselID", "status", "days", "limit"],
    purpose: "Returns document control overview including latest versions and approval statuses. Supports expiry-aware certificate queries directly through the MCP endpoint when `status=expired` or `status=expiring` is supplied.",
    whenToUse: "For finding outdated manuals, unapproved revisions, checking document tags, or answering expired/expiring certificate questions.",
    typicalQuestions: ["Show me documents tagged as 'temporary instructions'.", "Are outdated manuals being used?", "Show me expired certificates/documents.", "Which certificates are expiring soon?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "forms.query_status",
    method: "GET",
    path: "/api/mcp/forms/status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "templateID", "status", "limit"],
    purpose: "Returns due, overdue, submitted, and committed forms.",
    whenToUse: "Tracking formal checklist/form submissions required for compliance or operations.",
    typicalQuestions: ["Are there missing checklists for departure?", "Show me rejected safety forms."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "ptw.query_pipeline",
    method: "GET",
    path: "/api/mcp/ptw/pipeline",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "status", "limit"],
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
    optionalQuery: ["vesselID", "costCenterID", "limit"],
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
    optionalQuery: ["vendorID", "limit"],
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
    optionalQuery: ["limit"],
    purpose: "Returns fleet vessels with high-level maintenance KPIs, overdue counts, and stats.",
    whenToUse: "For executive dashboarding or finding the best/worst performing vessels fleet-wide.",
    typicalQuestions: ["Which vessels consistently exceed fleet averages for PMS compliance?", "Give me a fleet summary."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "fleet.query_machinery_status",
    method: "GET",
    path: "/api/mcp/fleet/machinery-status",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "criticalOnly", "limit"],
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
    optionalQuery: ["vesselID", "machineryID", "days", "limit"],
    purpose: "Returns daily machinery running hours log with totals and averages.",
    whenToUse: "To track machinery usage rates, condition monitoring trends, or verify operation logs.",
    typicalQuestions: ["Show me the running hours for the Aux Engines.", "Show me condition monitoring trends."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "Defaults to latest available hours if an explicit days window returns empty."
  },
  {
    name: "inventory.query_consumption_analysis",
    method: "GET",
    path: "/api/mcp/inventory/consumption-analysis",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "partID", "transactionType", "days", "limit"],
    purpose: "Returns parts consumption history, issue, transfer, and receipt trends.",
    whenToUse: "Analyzing exactly *where* and *how fast* parts are being used/transferred.",
    typicalQuestions: ["Which items are issued above average trend?", "Which spares are frequently transferred between vessels?"],
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
    optionalQuery: ["vesselID", "limit"],
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
    optionalQuery: ["vesselID", "status", "urgency", "days", "limit"],
    purpose: "Returns PO details with line items, urgency, and delivery status.",
    whenToUse: "Tracking order status, checking emergency orders.",
    typicalQuestions: ["Show me emergency orders raised outside vendor lists.", "Are there POs stuck in transit?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
  },
  {
    name: "procurement.query_invoice_logistics_returns",
    method: "GET",
    path: "/api/mcp/procurement/invoice-logistics-returns",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "invoiceStatus", "landingStatus", "returnStatus", "limit"],
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
    optionalQuery: ["vesselID", "status", "limit"],
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
    optionalQuery: ["vesselID", "crewMemberID", "days", "limit"],
    purpose: "Returns work/rest records, fatigue risk indicators, and compliance violations.",
    whenToUse: "Auditing strict MLC Work/Rest Hours violations or crew fatigue.",
    typicalQuestions: ["Show me crew members logging excessive hours or work/rest violations."],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
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
    optionalQuery: ["vesselID", "limit"],
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
    optionalQuery: ["limit"],
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
    optionalQuery: ["limit"],
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
    optionalQuery: ["vesselID", "partID", "locationID", "category", "criticalOnly", "lowStockOnly", "limit"],
    purpose: "Returns stock position, availability, reorder risk, and location mappings.",
    whenToUse: "General stock level checks, shortages, reorder levels.",
    typicalQuestions: ["Show me parts with repeated stock-outs.", "Where is the main engine piston?"],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"]
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
    optionalQuery: ["transactionType", "vesselID", "partID", "days", "limit"],
    purpose: "Returns inventory transaction history across receipt, issue, transfer, return, and return_to_vendor states.",
    whenToUse: "Use this for transaction-specific inventory questions like issued parts, returned-to-vendor parts, receipts, transfers, or general inventory movements.",
    whenNotToUse: "Not for current stock balance snapshots (use inventory.query_stock_position), dead stock detection, or overstock analysis.",
    typicalQuestions: [
      "Show me the issued parts.",
      "What parts were returned to vendor?",
      "Show recent inventory transfers.",
      "Show all inventory transactions for this vessel."
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "If transactionType is omitted, items may include mixed transaction states. Use summary.byTransactionType to understand the distribution across receipt, issue, transfer, return, and return_to_vendor."
  },
  {
    name: "inventory.query_stock_transfers",
    method: "GET",
    path: "/api/mcp/inventory/stock-transfers",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "partID", "days", "limit"],
    purpose: "Returns cross-vessel spare parts transfer transactions within the lookback window.",
    whenToUse: "To investigate which spares are frequently moved between vessels, or to check if a part was transferred away from a vessel that now needs it.",
    whenNotToUse: "Not for general stock level queries (use inventory.query_stock_position). Not for issue/receipt transactions (use inventory.query_consumption_analysis).",
    typicalQuestions: [
      "Which spares are being frequently transferred between vessels?",
      "Was any part sent from MV Atlantic to another vessel last month?",
      "Show me cross-fleet spare movements in the last 90 days."
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
    optionalQuery: ["vesselID", "status", "limit"],
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
    optionalQuery: ["vesselID", "limit"],
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
    optionalQuery: ["vesselID", "machineryID", "days", "limit"],
    purpose: "Returns daily running hours trends per machinery, aggregated to show avg, min, max, and total usage over the lookback window.",
    whenToUse: "When asked about running hours trends, condition-based maintenance indicators, or which machinery is being operated most intensively.",
    whenNotToUse: "Does not include sensor readings, vibration, or temperature data (those are outside the current MCP model). Use analytics.query_mtbf for failure frequency.",
    typicalQuestions: [
      "Show me condition monitoring trends for propulsion machinery.",
      "Which machinery show abnormal running hours this month?",
      "Show me the running hours for the Aux Engines over the last 30 days."
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "High avgDailyRunningHours relative to fleet norms may indicate over-reliance on particular machinery. maxDailyRunningHours vs minDailyRunningHours spread reveals load variability."
  },
  {
    name: "ptw.query_approval_stats",
    method: "GET",
    path: "/api/mcp/ptw/approval-stats",
    requiredQuery: ["organizationID"],
    optionalQuery: ["vesselID", "days", "limit"],
    purpose: "Returns PTW status breakdown and approval count metrics for a given period.",
    whenToUse: "When asked about PTW approval rates, how many permits were rejected, or how many approvals a typical permit requires.",
    whenNotToUse: "For open active permits use ptw.query_pipeline instead.",
    typicalQuestions: [
      "What is the average approval time for PTWs this month?",
      "Which vessel has the highest number of rejected permits?",
      "How many hot work permits were approved vs rejected?"
    ],
    responseShape: ["capability", "organizationID", "appliedFilters", "summary", "items"],
    interpretationGuidance: "summary.byStatus.rejected.count shows rejected PTWs. avgApprovals per status shows the workflow depth. High approval counts may indicate inefficient permit workflows."
  },
  {
    name: "fleet.query_risk_summary",
    method: "GET",
    path: "/api/mcp/fleet/risk-summary",
    requiredQuery: ["organizationID"],
    optionalQuery: ["limit"],
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

export const capabilitiesContractDocs = {
  service: "PhoenixCloud MCP",
  version: "0.1.0",
  authExpectations: "Token-based. organizationID is required on every route.",
  generalGuidance: "Direct Mongoose reads. Do NOT infer fake cross-org relationships. Use composed queries for complex data points.",
  emptyResultInterpretation: "An empty 'items' array means no documents matched the applied tenant/filter query. During MCP validation, treat empties as needing direct DB confirmation before accepting them as truly empty.",
  capabilities: capabilitiesContract
};
