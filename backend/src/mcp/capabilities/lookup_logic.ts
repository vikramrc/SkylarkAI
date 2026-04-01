import { MongoClient, ObjectId } from "mongodb";

/**
 * Registry mapping conversational entity types (verbatim collection names) 
 * to their primary text identifier properties for regex searching.
 */
const RESOLVABLE_ENTITIES: Record<string, { 
  searchFields: string[]; 
  idField: string; 
  displayField: string;
}> = {
  Vessel: { 
    searchFields: ["vesselName", "vessel_IMO_Number"], 
    idField: "_id", 
    displayField: "vesselName" 
  },
  Organization: { 
    searchFields: ["organizationName", "orgShortName"], 
    idField: "_id", 
    displayField: "organizationName" 
  },
  Activity: { 
    searchFields: ["description"], 
    idField: "_id", 
    displayField: "description" 
  },
  ActivityWorkHistory: { 
    searchFields: ["latestEventDescription", "downtimeDescription"], 
    idField: "_id", 
    displayField: "latestEventDescription" 
  },
  Machinery: { 
    searchFields: ["machineryName", "machineryDescription", "model", "serialNumber"], 
    idField: "_id", 
    displayField: "machineryName" 
  },
  Component: { 
    searchFields: ["componentName", "sfiCode"], 
    idField: "_id", 
    displayField: "componentName" 
  },
  InventoryPart: { 
    searchFields: ["partName", "partNumber", "description"], 
    idField: "_id", 
    displayField: "partName" 
  },
  InventoryLocation: { 
    searchFields: ["locationName", "locationCode"], 
    idField: "_id", 
    displayField: "locationName" 
  },
  MaintenanceSchedule: { 
    searchFields: ["name"], 
    idField: "_id", 
    displayField: "name" 
  },
  Vendor: { 
    searchFields: ["vendorName", "vendorCode"], 
    idField: "_id", 
    displayField: "vendorName" 
  },
  CrewMember: { 
    searchFields: ["firstName", "lastName", "rankCode"], 
    idField: "_id", 
    displayField: "firstName" 
  },
  FormTemplate: { 
    searchFields: ["templateName", "templateCode"], 
    idField: "_id", 
    displayField: "templateName" 
  },
  CostCenter: { 
    searchFields: ["name", "code"], 
    idField: "_id", 
    displayField: "name" 
  },
  BudgetCode: { 
    searchFields: ["name", "code"], 
    idField: "_id", 
    displayField: "name" 
  },
  Budget: { 
    searchFields: ["name"], 
    idField: "_id", 
    displayField: "name" 
  },
  PurchaseOrder: { 
    searchFields: ["purchaseOrderNumber", "description"], 
    idField: "_id", 
    displayField: "purchaseOrderNumber" 
  },
  Invoice: { 
    searchFields: ["invoiceNumber", "description"], 
    idField: "_id", 
    displayField: "invoiceNumber" 
  },
  PTW: { 
    searchFields: ["permitNumber", "description"], 
    idField: "_id", 
    displayField: "permitNumber" 
  },
  DocumentMetadata: { 
    searchFields: ["name", "description"], 
    idField: "_id", 
    displayField: "name" 
  },
  User: { 
    searchFields: ["firstName", "lastName", "email"], 
    idField: "_id", 
    displayField: "firstName" 
  },
};

/**
 * Unified Resolution Engine: Performs direct database lookups for entity names/codes.
 * This replaces the previous hybrid discovery model for better reliability.
 */
export async function resolveEntities(args: { 
  entityType: string; 
  searchTerm: string; 
  organizationID?: string;
  organizationShortName?: string;
  organizationName?: string;
  vesselID?: string;
  vesselName?: string;
}, token: string) {
  const { entityType, searchTerm, organizationID, organizationShortName, organizationName, vesselID, vesselName } = args;
  
  console.log(`[Discovery Engine] Unified Resolve: Searching collection "${entityType}" for term: "${searchTerm}"`);

  const mongoUri = process.env.PHOENIX_MONGO_URI || process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/ProductsDB';
  const dbName = mongoUri.split('/').pop()?.split('?')[0] || 'ProductsDB';
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    // 1. Resolve Organization/Vessel Scope first if they are names
    let resolvedOrgID = organizationID;
    let resolvedVesselID = vesselID;

    // Resolve Org if shortName or Name supplied
    if (!resolvedOrgID && (organizationShortName || organizationName)) {
        const org = await db.collection('Organization').findOne(
          organizationShortName
            ? { orgShortName: new RegExp(`^${organizationShortName}$`, 'i') }
            : { organizationName: new RegExp(`^${organizationName}$`, 'i') },
          { projection: { _id: 1 } }
        );
        if (org) resolvedOrgID = String(org._id);
    }

    // Resolve Vessel if Name supplied
    if (!resolvedVesselID && vesselName && resolvedOrgID) {
        const ves = await db.collection('Vessel').findOne(
          { 
              vesselName: new RegExp(`^${vesselName}$`, 'i'),
              organizationID: new ObjectId(resolvedOrgID)
          },
          { projection: { _id: 1 } }
        );
        if (ves) resolvedVesselID = String(ves._id);
    }

    // 2. Build Query Filters
    const orgFilter: Record<string, any> = {};
    if (resolvedOrgID) orgFilter.organizationID = new ObjectId(resolvedOrgID);
    if (resolvedVesselID) orgFilter.vesselID = new ObjectId(resolvedVesselID);

    const config = RESOLVABLE_ENTITIES[entityType];
    const searchFields = config?.searchFields || ["name", "description", "code", "title"];
    const idField = config?.idField || "_id";
    const displayField = config?.displayField || "name";

    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    // Prepare search $or clause
    const searchClause = {
        $or: searchFields.map(field => ({ [field]: regex }))
    };

    // 3. Execute Search
    const docs = await db.collection(entityType).find({
      ...orgFilter,
      ...searchClause,
      active: { $ne: false } // Only return active entities if collection supports it
    }).limit(10).toArray();

    if (docs.length === 0) {
      console.warn(`[Discovery Engine] ⚠️ No matches in collection "${entityType}" for "${searchTerm}"`);
      return { 
        content: [{ 
            type: 'text', 
            text: `No matches found in ${entityType} for "${searchTerm}". Please check your spelling or verify the organization/vessel scope.` 
        }] 
      };
    }

    const matches = docs.map(doc => ({
      id: String(doc[idField] || doc._id),
      label: doc[displayField] || doc.name || doc.description || doc.vesselName || "Unnamed",
      type: entityType,
    }));

    console.log(`[Discovery Engine] ✅ Found ${matches.length} matches for "${searchTerm}" in ${entityType}`);
    
    return {
      content: [{ 
          type: 'text', 
          text: JSON.stringify({
              capability: 'mcp.resolve_entities',
              appliedFilters: { entityType, searchTerm, organizationID: resolvedOrgID, vesselID: resolvedVesselID },
              items: matches.slice(0, 5),
          }) 
      }]
    };

  } catch (err: any) {
    console.error(`[Discovery Engine] Error resolving ${entityType}:`, err);
    return {
      content: [{ type: "text", text: `Error connecting to discovery engine: ${err.message}` }],
      isError: true
    };
  } finally {
    await client.close();
  }
}
