export const KNOWLEDGE_GRAPH = {
  "system": "Phoenix PMS (Planned Maintenance System)",
  "version": "1.1",
  "domains": [
    {
      "name": "Machinery Lifecycle & Maintenance",
      "hierarchy": "Vessel → Machinery → Component → Activity",
      "description": "Models the entire operational lifecycle of vessel equipment. Includes criticality and performance tracking.",
      "core_models": {
        "Machinery": "Vessel asset. Tracks 'isCritical', 'avgRunningHoursPerMonth', and 'actualRunningHoursSinceLastMaintenance'. Linked to Manufacturer and DMS Manuals.",
        "Component": "Specific sub-unit of a Machinery. Supports nested 'parentComponentID'. Maps directly to 'partIds' for spare part compatibility.",
        "ComponentActivity": "The 'Bridge': Maps specific Components to their valid Activities. AI should check this mapping to find valid jobs for a machine.",
        "MaintenanceSchedule": "Groups components and activities into a vessel-specific plan with revision history.",
        "Activity": "Planned task with intervals (hours, days, weeks, months, voyage). Includes instructions, rank/competency, spares, and PTW needs.",
        "ActivityWorkHistory (AWH)": "Operational instance of a task. Captures due date, downtime, failure classification, and performance data.",
        "ActivityWorkHistoryEvent": "Timeline of granular actions (create, complete, reschedule, suspend, cancel) with evidence, crew, and parts used."
      },
      "extended_concepts": [
        "Critical Equipment priority logic",
        "Running hour based dynamic scheduling",
        "Survey & drydock integration",
        "Manufacturer Drawing Numbers (DMS linked)"
      ]
    },
    {
      "name": "Supply Chain & Inventory",
      "description": "Integrated management of spare parts from catalog to bin-level stock on vessels and shore.",
      "core_models": {
        "InventoryPart": "Master data for parts. Includes part numbers, categories, machinery compatibility, lead times, and shelf life.",
        "InventoryStock": "Per-part quantities at specific locations (vessel stores, shore warehouses, workshops).",
        "InventoryTransaction": "Source of truth for every receipt, issue, transfer, or return. Records actual cost at point of issue.",
        "Vendor": "Supplier data including reliability and ratings.",
        "PurchaseOrder": "External procurement lifecycle (vendor selection, ordering, partial receipts).",
        "ReplenishOrder": "Internal logistics for stock transfers between locations.",
        "LandingOrder": "Offloading/Returns from vessel to shore marked with serial 'MLO-'. Captures item condition: 'unused', 'used', 'damaged', 'non_functional'.",
        "MaintenancePartUsage": "The bridge: captures actual consumption, issuer, and cost during job execution."
      },
      "stock_rules": [
        "Closed Landing Orders represent final stock reductions from the vessel.",
        "InventoryTransaction records are the ONLY source of truth for stock levels."
      ]
    },
    {
      "name": "Financials & Budgeting",
      "description": "Full cost control framework for monitoring maintenance expenditure across vessels and departments.",
      "core_models": {
        "Budget": "Financial allocation for a period (fiscal year, quarter). Vessel/Department specific.",
        "BudgetCode": "Chart of accounts for consistent classification (Engine, Deck, Repairs, Spares).",
        "BudgetAllocation": "The bridge: maps operational work (AWH/Spares) to a specific Budget/CostCenter.",
        "Invoice": "The financial bridge: tracks supplier billing against POs or AWH. Supports partial invoicing.",
        "BudgetTransaction": "The ledger capturing commitments, accruals, expenditures, and credit adjustments.",
        "BudgetAuditLog": "Accountability trail for amount revisions and status changes."
      },
      "accounting_logic": [
        "Invoices trigger the transition from ACCRUAL to ACTUAL in the budget ledger.",
        "BudgetAllocations act as real-time financial placeholders until settled by Invoice."
      ]
    },
    {
      "name": "Crew & Human Factor",
      "description": "Management of seafarers, assignments, and strictly monitored work-rest compliance.",
      "core_models": {
        "CrewMember": "Individual profile, rank, certification, and contract history. Linked to system User accounts.",
        "CrewAssignment": "Links personnel to vessels and schedules (Permanent, Riding Crew, Contractor).",
        "ShiftPattern": "Maritime watch systems (4-on/8-off) or day-work duty cycles.",
        "WorkRestRecord": "Daily log of work (watchkeeping, drills) and rest. Evaluates MLC/STCW compliance violations.",
        "AdhocRosterBlock": "Captures unscheduled operational realities (emergency work) for compliance accuracy."
      }
    },
    {
      "name": "Compliance & Documentation",
      "description": "Safety management framework for regulatory readiness and high-risk operational authorization.",
      "core_models": {
        "DocumentMetadata / DocumentFile": "Version-controlled technical manuals, certificates, and procedures with approval lineage.",
        "FormTemplate": "Reusable checklists and inspection forms mapped to vessels or activities.",
        "Form / FormActionHistory": "Submitted instances with full audit trail of approvals and evidence.",
        "Permit-To-Work (PTW)": "Safety authorization for Hot Work, Enclosed Space, aloft work, etc. Rooted in risk assessment."
      }
    },
    {
      "name": "Operational Intelligence",
      "description": "Cross-domain classification and data correlate tools for fleet-wide insights.",
      "core_models": {
        "SfiNode": "International SFI coding hierarchy. Categorizes maintenance, parts, and documents by engineering standard.",
        "DailyMachineryRunningHours": "Correlates machinery usage with voyage patterns (port codes, destinations) for predictive maintenance.",
        "SearchableTag": "Flexible operational tagging for non-conformities, inspection findings, or safety trends across all modules."
      }
    }
  ]
};
