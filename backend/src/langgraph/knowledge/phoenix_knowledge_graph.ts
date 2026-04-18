export const KNOWLEDGE_GRAPH = {
  "system": "Phoenix PMS (Planned Maintenance System)",
  "version": "2.1",
  "USAGE_PREAMBLE": `This graph defines the architectural boundaries and operational ties of the Phoenix PMS. It maps the vertical hierarchies and horizontal relationships of the 80+ maritime models.

COMPONENT DEFINITIONS:
1. DOMAIN_HIERARCHIES: Defines Vertical Ownership / Containment. Use this to perform Rule 1 (Structural Inference) in your induction protocol — if you see a child entity, the unclassified label is the parent.
2. ENTITY_RELATIONSHIPS: Defines Horizontal Bridges / Associations. Use this to navigate across disparate functional silos once an anchor is established.
3. REASONING_INFERENCE_MAP: Defines Semantic Proximity. Bridges colloquial/technical human terms to the formal structures above.

Use this map to reconcile unclassified labels against required tool parameters and to navigate complex multi-hop queries based on the Relational Deduction Protocol in your rules.`,

  "DOMAIN_HIERARCHIES": {
    "Technical_Maintenance": "Vessel (vesselID) → MaintenanceSchedule (scheduleID) → Machinery (machineryID) → Component (componentID) → Activity (activityID) → ActivityWorkHistory (awhID) → ActivityWorkHistoryEvent (eventID)",
    "Procurement_Strategy": "Organization (orgID) → Vendor (vendorID) → RFQ (rfqID) → PurchaseOrder (poID) → LandingOrder (Receipt/loID) → ReturnOrder (RMA/rtvID)",
    "Financial_Architecture": "Organization (orgID) → Budget (budgetID) → BudgetCode (budgetCodeID) → CostCenter (costCenterID) → BudgetAllocation (allocationID) → Invoice (invoiceID)",
    "Inventory_Lifecycle": "Organization (orgID) → InventoryPart (partID) → InventoryLocation (locationID) → InventoryStock (stockID) → InventoryTransaction (transactionID)",
    "Personnel_Readiness": "Organization (orgID) → CrewMember (crewMemberID) → CrewAssignment (assignmentID) → WorkRestRecord (recordID) → Violation (violationType)",
    "Safety_Compliance": "Vessel (vesselID) → FormTemplate (templateID) → Form (formID) → FormActionHistory (historyID) → FormSequence (sequenceID)",
    "Document_Management": "Organization (orgID) → DocumentType (documentType) → DocumentMetadata (metadataID) → DocumentFile (fileID)"
  },

  "ENTITY_RELATIONSHIPS": [
    // Cross-Domain Bridges
    { "from": "Activity", "to": "InventoryPart", "key": "requiredParts", "relation": "Maintenance Spares Requirement" },
    { "from": "ActivityWorkHistory", "to": "BudgetAllocation", "key": "activityWorkHistoryID", "relation": "Financial tracking for maintenance spend" },
    { "from": "BudgetAllocation", "to": "Invoice", "key": "budgetAllocationID", "relation": "Settlement of maintenance costs" },
    { "from": "PurchaseOrder", "to": "Budget", "key": "budgetID", "relation": "Financial commitment for procurement" },
    { "from": "PurchaseOrder", "to": "InventoryPart", "key": "lineItems.partID", "relation": "Spare parts procurement" },
    { "from": "LandingOrder", "to": "Vessel", "key": "vesselID", "relation": "Inventory receipt at point of consumption" },
    { "from": "ReturnOrder", "to": "PurchaseOrder", "key": "purchaseOrderID", "relation": "RMA integration for supply chain quality" },
    { "from": "InventoryPart", "to": "Machinery", "key": "compatibleMachinery", "relation": "Asset compatibility for spare parts" },
    { "from": "Activity", "to": "FormTemplate", "key": "ptwFormTemplateIDs", "relation": "Compliance/Safety permit requirements (PTW)" },
    { "from": "ActivityWorkHistory", "to": "Form", "key": "activityWorkHistoryID", "relation": "Evidence capture via checklists" },
    { "from": "CrewAssignment", "to": "Activity", "key": "activityID", "relation": "Personnel task allocation" },
    { "from": "CrewMember", "to": "DocumentMetadata", "key": "certificateDocumentIDs", "relation": "Seafarer certification and compliance (STCW)" },
    { "from": "DocumentMetadata", "to": "Machinery", "key": "customMetadata.relatedMachinery", "relation": "Technical manual and drawing linkage" },
    { "from": "Vessel", "to": "Budget", "key": "vesselID", "relation": "Financial allocation for specific assets" },
    { "from": "Vessel", "to": "VesselPortSchedule", "key": "vesselID", "relation": "Port stay and maintenance windows" },
    { "from": "Activity", "to": "VesselPortSchedule", "key": "needsPortStay", "relation": "Maintenance constraint based on port availability" },
    { "from": "ActivityWorkHistory", "to": "FailureCodeTrainingMap", "key": "failureCode", "relation": "Root cause mapping to training interventions" },
    { "from": "ActivityWorkHistory", "to": "CrewCompetencySignal", "key": "impliedCompetencySignalIDs", "relation": "Competency gap evidence from historical failures" },
    { "from": "CrewMember", "to": "FailureCodeTrainingMap", "key": "requiredCompetency", "relation": "STCW compliance tied to failure mitigation" },
    { "from": "InventoryPart", "to": "InventoryPart", "key": "substitutePartIDs", "relation": "Interchangeable spare parts" }
  ],

  "REASONING_INFERENCE_MAP": {
    "Vessel": ["schedules", "machinery", "status", "fleet", "certificates", "imo", "noon", "vsl", "vessel", "ship", "port call", "port stay"],
    "Machinery": ["running hours", "instructions", "components", "criticality", "engine", "pump", "boiler", "SFI", "equipment"],
    "Part": ["stock", "receipt", "issue", "inventory", "part number", "spares", "consumables", "lead time", "substitute", "interchangeable", "cross reference"],
    "Financial": ["spending", "transactions", "actuals", "variance", "budget", "accounting", "cost center", "invoice", "accrual"],
    "Crew": ["rank", "assignment", "work/rest", "seafarer", "stcw", "nationality", "MLC", "fatigue", "training", "competency"],
    "Compliance": ["checklist", "inspection", "survey", "permit", "ptw", "compliance", "RMA", "non-conformity", "quality", "failure", "RCA", "root cause", "repair type", "temporary fix", "quality error", "iso 14224", "breakdown"],
    "Procurement": ["ordering", "delivery", "receipt", "po", "rfq", "vendor", "replenish", "pipeline"]
  }
};
