import { MongoClient, ObjectId } from "mongodb";
import * as fs from "fs";
import * as path from "path";

// 🟢 GAP-10 FIX: Module-level singleton MongoDB client.
// Previously, every resolve_entities call opened a fresh TCP connection and immediately closed it.
// Under concurrent requests (e.g., Strategic Interceptor firing 3 parallel entity type resolutions),
// this creates N simultaneous connect+close cycles, exhausting the MongoDB connection pool rapidly.
// Solution: shared client that stays connected for the lifetime of the process.
const mongoUri = process.env.PHOENIX_MONGO_URI || process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/ProductsDB';
const _sharedClient = new MongoClient(mongoUri, { maxPoolSize: 10 });
let _clientConnected = false;

async function getSharedDb(): Promise<ReturnType<MongoClient['db']>> {
    if (!_clientConnected) {
        await _sharedClient.connect();
        _clientConnected = true;
        console.log('[Discovery Engine] 🔗 Shared MongoDB client connected.');
    }
    const dbName = mongoUri.split('/').pop()?.split('?')[0] || 'ProductsDB';
    return _sharedClient.db(dbName);
}

/**
 * Registry mapping LLM-facing entity type names to their search configuration.
 * 
 * ⚠️ ALL FIELDS HAVE BEEN AUDITED AGAINST LIVE MongoDB ProductsDB.
 * If a field is listed here it MUST exist in the live collection, otherwise
 * the $or search clause will return 0 results (MongoDB silently ignores missing fields
 * but wastes index scans). Stale fields are removed, not commented out.
 */
/**
 * Optional join config for entities that have no direct organizationID/vesselID field.
 * When present, the resolver uses an aggregation pipeline to join through the parent
 * collection and applies org/vessel scoping on the parent instead of on the entity itself.
 */
type JoinThrough = {
  /** Actual MongoDB collection name of the parent/junction collection. */
  collection: string;
  /** Field on the child entity (this collection) that references the parent. Used when inverted=false. */
  localField: string;
  /** Field on the parent collection that the localField points to (usually "_id"). Used when inverted=false. */
  foreignField: string;
  /** Field name on the parent used for org scoping (e.g. "organizationID"). */
  orgField?: string;
  /** Field name on the parent used for vessel scoping (e.g. "vesselID"). */
  vesselField?: string;
  /**
   * When true, the FK is on the junction collection (not on this entity).
   * The aggregation starts from `collection`, filters by org+vessel,
   * then joins back to THIS collection via `entityLookupField`.
   * Use for entities like CrewMember where CrewAssignment holds the FK.
   */
  inverted?: boolean;
  /** When inverted=true: the field on the junction collection that references this entity's _id. */
  entityLookupField?: string;
};

const RESOLVABLE_ENTITIES: Record<string, {
  searchFields: string[];
  idField: string;
  displayField: string;
  /** If set, org/vessel scoping is applied via an aggregation join through this parent. */
  joinThrough?: JoinThrough;
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
    // Activity has no org/vessel FK — scoped via its parent Machinery.
    // ⚠️ AUDITED: Machinery has NO organizationID field (only vesselID).
    // orgField is intentionally omitted — applying an org filter on a non-existent field
    // causes Stage 4 of the aggregation to match 0 documents, silently killing all results.
    // Vessel scoping (vesselField) provides implicit org isolation since vessels are org-exclusive.
    // joinThrough causes the resolver to use an aggregation pipeline instead of a plain find().
    searchFields: ["description"],
    idField: "_id",
    displayField: "description",
    joinThrough: {
      collection: "Machinery",
      localField: "machineryID",
      foreignField: "_id",
      // orgField intentionally absent — Machinery has no organizationID field
      vesselField: "vesselID",
    },
  },
  ActivityWorkHistory: {
    // org/vessel stored as plain strings (not ObjectIds) — caught by dynamic schema discovery
    searchFields: ["latestEventDescription", "downtimeDescription"],
    idField: "_id",
    displayField: "latestEventDescription"
  },
  Machinery: {
    // 🔍 Audited: live DB only has machineryName + sfiCode; model/serialNumber/machineryDescription do NOT exist
    searchFields: ["machineryName", "sfiCode"],
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
    // 🔍 Audited: "name" field does NOT exist; correct fields are shortName + maintenanceScheduleDescription
    // org/vessel stored as plain strings — caught by dynamic schema discovery
    searchFields: ["shortName", "maintenanceScheduleDescription"],
    idField: "_id",
    displayField: "shortName"
  },
  Vendor: {
    searchFields: ["vendorName", "vendorCode"],
    idField: "_id",
    displayField: "vendorName"
  },
  CrewMember: {
    // 🔍 Audited: has rankCode and rankName in live DB (no generic "rank" field)
    // CrewMember has no vesselID — active vessel is tracked via CrewAssignment.
    // inverted joinThrough: start from CrewAssignment (filtered by vessel), then look up CrewMember.
    searchFields: ["firstName", "lastName", "rankCode", "rankName"],
    idField: "_id",
    displayField: "firstName",
    joinThrough: {
      collection: "CrewAssignment",
      localField: "_id",          // unused in inverted path, kept for type conformance
      foreignField: "crewMemberID", // CrewAssignment.crewMemberID → CrewMember._id
      orgField: "organizationID",
      vesselField: "vesselID",
      inverted: true,
      entityLookupField: "crewMemberID", // the field on CrewAssignment pointing at CrewMember
    },
  },
  FormTemplate: {
    // 🔍 FIXED: live DB uses "name" field, NOT templateName/templateCode (those do not exist)
    searchFields: ["name", "description"],
    idField: "_id",
    displayField: "name"
  },
  // 🟢 Form resolution.
  // The vector schema calls this "Form" but the actual MongoDB collection is "forms" (lowercase plural).
  // Mongoose pluralizes model names automatically. The COLLECTION_ALIAS_MAP below routes "Form" → "forms".
  // Resolution supports matching by form name or description. To find by template, use FormTemplate first.
  Form: {
    searchFields: ["name", "description"],
    idField: "_id",
    displayField: "name"
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
    // 🔍 FIXED: live DB uses "poNumber" field, NOT "purchaseOrderNumber" (does not exist)
    searchFields: ["poNumber", "description"],
    idField: "_id",
    displayField: "poNumber"
  },
  Invoice: {
    searchFields: ["invoiceNumber", "description"],
    idField: "_id",
    displayField: "invoiceNumber"
  },
  // 🔍 FIXED: actual MongoDB collection is "Ptw" (mixed case), not "PTW".
  // "PTW" is kept as a LLM-alias key in COLLECTION_ALIAS_MAP → "Ptw".
  Ptw: {
    searchFields: ["ptwNumber", "description"],
    idField: "_id",
    displayField: "ptwNumber"
  },
  DocumentMetadata: {
    // 🔍 FIXED: live DB uses "documentName" field, NOT "name" (which is undefined on live docs)
    searchFields: ["documentName", "description"],
    idField: "_id",
    displayField: "documentName"
  },
  User: {
    searchFields: ["firstName", "lastName", "email"],
    idField: "_id",
    displayField: "firstName"
  },
  // 🟢 Competency Signal resolution — enables mcp.resolve_entities to return _id ObjectId
  // for signal names like "Tanker Management". The downstream tool (crew.query_competency_diagnostics)
  // accepts this ObjectId as competencySignalID and resolves the internal signalID string itself.
  CrewCompetencySignal: {
    searchFields: ["label", "signalID"],
    idField: "_id",
    displayField: "label"
  },
  ReplenishOrder: {
    searchFields: ["orderNumber", "remarks"],
    idField: "_id",
    displayField: "orderNumber"
  },
  VesselPortSchedule: {
    searchFields: ["portName", "description"],
    idField: "_id",
    displayField: "portName"
  },
  DailyMachineryRunningHours: {
    // Used to resolve running hour entries by machinery context
    searchFields: ["machineryName", "remarks"],
    idField: "_id",
    displayField: "machineryName"
  },
};

/**
 * Collection Name Alias Map.
 * Maps LLM-facing entity type names to their ACTUAL MongoDB collection names.
 *
 * Why this exists: Mongoose auto-pluralizes and lowercases model names when creating collections.
 * The LLM and vector schema use the singular PascalCase names (e.g. "Form", "PTW") but the actual
 * MongoDB collections are "forms" and "Ptw". This map is the single source of truth for that mapping.
 */
const COLLECTION_ALIAS_MAP: Record<string, string> = {
  Form:       'forms',  // Mongoose pluralizes Form → forms
  PTW:        'Ptw',    // Old all-caps alias; actual collection is mixed-case "Ptw"
};

// Resolve LLM entity type name to actual MongoDB collection name
function resolveCollectionName(entityType: string): string {
  return COLLECTION_ALIAS_MAP[entityType] ?? entityType;
}

/**
 * Dynamic Schema Discovery & Metadata Cache.
 *
 * Instead of maintaining brittle hardcoded sets of "which collections support org/vessel filters"
 * and "which use strings vs ObjectIds", we discover this at runtime by sampling one document
 * from each collection. Results are cached in-memory for the process lifetime (warm after first call).
 *
 * Fallback: If the collection is empty, we parse pms_collections_vector_schema.json to infer
 * the expected schema from its Description field.
 */
type CollectionMetadata = {
  hasOrg: boolean;
  hasVessel: boolean;
  orgType: 'string' | 'ObjectId';
  vesselType: 'string' | 'ObjectId';
  activeField: string | null;
};

const _metadataCache: Record<string, CollectionMetadata> = {};
let _vectorSchema: any[] = [];

try {
  const schemaPath = path.join(process.cwd(), 'seed/pms_collections_vector_schema.json');
  if (fs.existsSync(schemaPath)) {
    _vectorSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    console.log(`[Discovery Engine] 📄 Loaded vector schema fallback (${_vectorSchema.length} entries).`);
  }
} catch (e) {
  console.warn('[Discovery Engine] ⚠️ Could not load vector schema for fallbacks.', e);
}

async function getCollectionMetadata(db: any, collectionName: string): Promise<CollectionMetadata> {
  if (_metadataCache[collectionName]) return _metadataCache[collectionName];

  const sample = await db.collection(collectionName).findOne({});

  if (!sample) {
    // Fallback: parse vector schema description text to infer schema
    // Note: vector schema uses CollectionName (not the aliased collection name), so we check both
    const schemaEntry = _vectorSchema.find(s =>
      s.CollectionName === collectionName ||
      Object.entries(COLLECTION_ALIAS_MAP).find(([k, v]) => v === collectionName && s.CollectionName === k)
    );
    const desc = schemaEntry?.Description || "";

    const metadata: CollectionMetadata = {
      hasOrg:     desc.includes('organizationID'),
      hasVessel:  desc.includes('vesselID'),
      // Vector schema uses "(string)" vs "(ObjectId" in type annotations to distinguish
      orgType:    desc.includes('organizationID (string') ? 'string' : 'ObjectId',
      vesselType: desc.includes('vesselID (string')       ? 'string' : 'ObjectId',
      activeField: desc.includes('isActive') ? 'isActive' : (desc.includes('active (boolean') ? 'active' : null)
    };

    console.log(`[Discovery Engine] 📋 Schema inferred from vector schema for "${collectionName}" (empty collection):`, metadata);
    // Don't cache — collection may get populated later, and we'd want to re-discover from live data
    return metadata;
  }

  const metadata: CollectionMetadata = {
    hasOrg:    'organizationID' in sample,
    hasVessel: 'vesselID' in sample,
    // ObjectId check: native BSON ObjectId OR a plain object that is not null (covers sub-documents).
    // A plain string like "67eedd60c1ceddb21d80ad45" will be typeof === 'string', not 'object'.
    orgType:    (sample.organizationID instanceof ObjectId || (typeof sample.organizationID === 'object' && sample.organizationID !== null))
                  ? 'ObjectId' : 'string',
    vesselType: (sample.vesselID instanceof ObjectId || (typeof sample.vesselID === 'object' && sample.vesselID !== null))
                  ? 'ObjectId' : 'string',
    activeField: 'isActive' in sample ? 'isActive' : ('active' in sample ? 'active' : null)
  };

  _metadataCache[collectionName] = metadata;
  console.log(`[Discovery Engine] 🔍 Discovered schema for "${collectionName}":`, metadata);
  return metadata;
}

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

  // Resolve LLM entity name to actual MongoDB collection name
  const collectionName = resolveCollectionName(entityType);

  console.log(`[Discovery Engine] Unified Resolve: Searching collection "${collectionName}" (entityType="${entityType}") for term: "${searchTerm}"`);

  // 🟢 GAP-10: Use shared singleton client instead of per-call connect/close
  try {
    const db = await getSharedDb();

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
        if (org) {
            resolvedOrgID = String(org._id);
        } else {
            console.warn(`[Discovery Engine] ⚠️ Organization not found. Rejecting open search.`);
            return {
                content: [{ type: "text", text: `Error: Organization not found for "${organizationShortName || organizationName}"` }],
                isError: true
            };
        }
    }

    // Resolve Vessel if Name supplied (Vessel collection always uses ObjectId for org)
    if (!resolvedVesselID && vesselName && resolvedOrgID) {
        const ves = await db.collection('Vessel').findOne(
          {
              vesselName: new RegExp(`^${vesselName}$`, 'i'),
              organizationID: new ObjectId(resolvedOrgID)
          },
          { projection: { _id: 1 } }
        );
        if (ves) {
            resolvedVesselID = String(ves._id);
        } else {
            console.warn(`[Discovery Engine] ⚠️ Vessel not found. Rejecting open search.`);
            return {
                content: [{ type: "text", text: `Error: Vessel not found for "${vesselName}"` }],
                isError: true
            };
        }
    }

    // 2. Build Query Filters dynamically based on discovered collection schema
    const metadata = await getCollectionMetadata(db, collectionName);
    const queryFilter: Record<string, any> = {};

    if (resolvedOrgID && metadata.hasOrg) {
        // Apply org filter with the correct ID type for this specific collection
        queryFilter.organizationID = metadata.orgType === 'ObjectId'
            ? new ObjectId(resolvedOrgID)
            : resolvedOrgID;
    }
    if (resolvedVesselID && metadata.hasVessel) {
        // Apply vessel filter with the correct ID type for this specific collection
        queryFilter.vesselID = metadata.vesselType === 'ObjectId'
            ? new ObjectId(resolvedVesselID)
            : resolvedVesselID;
    }

    console.log(`[Discovery Engine] 🔍 Scope for "${collectionName}": hasOrg=${metadata.hasOrg}(${metadata.orgType}) | hasVessel=${metadata.hasVessel}(${metadata.vesselType}) | resolvedOrgID=${resolvedOrgID || 'none'} | resolvedVesselID=${resolvedVesselID || 'none'} | queryFilter=${JSON.stringify(queryFilter)}`);

    // 3. Build search clause from registered fields
    const config = RESOLVABLE_ENTITIES[entityType];
    const searchFields = config?.searchFields || ["name", "description", "code", "title"];
    const idField = config?.idField || "_id";
    const displayField = config?.displayField || "name";

    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const searchClause = {
        $or: searchFields.map(field => ({ [field]: regex }))
    };

    // 4. Apply active/isActive filter only if the collection actually has that field
    const activeFilter = metadata.activeField
        ? { [metadata.activeField]: { $ne: false } }
        : {};

    // 5. Execute Search
    // If this entity type has a joinThrough config, use an aggregation pipeline that
    // applies org/vessel scoping on the PARENT collection rather than on this entity.
    let docs: any[];
    if (config?.joinThrough) {
      const jt = config.joinThrough;
      const parentMeta = await getCollectionMetadata(db, jt.collection);

      if (jt.inverted && jt.entityLookupField) {
        // ─── INVERTED PATH ────────────────────────────────────────────────────────
        // The FK lives on the junction collection, not on this entity.
        // Strategy: start from the junction collection, filter by org+vessel,
        // collect the entity IDs, then look up the entity and apply the search term.
        // This avoids duplicates because we $group by entity _id before the search.
        // ─────────────────────────────────────────────────────────────────────────
        const junctionMatch: Record<string, any> = {};
        if (resolvedOrgID && jt.orgField) {
          junctionMatch[jt.orgField] = parentMeta.orgType === 'ObjectId'
            ? new ObjectId(resolvedOrgID)
            : resolvedOrgID;
        }
        if (resolvedVesselID && jt.vesselField) {
          junctionMatch[jt.vesselField] = parentMeta.vesselType === 'ObjectId'
            ? new ObjectId(resolvedVesselID)
            : resolvedVesselID;
        }

        const pipeline: any[] = [];

        // Stage 1: filter junction collection by org+vessel
        if (Object.keys(junctionMatch).length > 0) {
          pipeline.push({ $match: junctionMatch });
        }

        // Stage 2: deduplicate entity IDs (one crew member can have many assignments)
        pipeline.push({ $group: { _id: `$${jt.entityLookupField}` } });

        // Stage 3: join to the actual entity collection
        pipeline.push({
          $lookup: {
            from: collectionName,
            localField: '_id',
            foreignField: '_id',
            as: '_entity',
          },
        });
        pipeline.push({ $unwind: '$_entity' });

        // Stage 4: apply active flag and search term on the entity
        const entityMatchClauses: Record<string, any> = {};
        if (metadata.activeField) {
          entityMatchClauses[`_entity.${metadata.activeField}`] = { $ne: false };
        }
        // Rebuild search clause scoped under _entity.*
        const entitySearchOr = searchFields.map(field => ({ [`_entity.${field}`]: regex }));
        pipeline.push({ $match: { ...entityMatchClauses, $or: entitySearchOr } });

        // Stage 5: replace root with the entity doc and cap results
        pipeline.push({ $replaceRoot: { newRoot: '$_entity' } });
        pipeline.push({ $limit: 10 });

        docs = await db.collection(jt.collection).aggregate(pipeline).toArray();
        console.log(`[Discovery Engine] 🔗 Inverted JoinThrough for "${collectionName}" via "${jt.collection}": ${docs.length} results (vesselID=${resolvedVesselID || 'any'}, orgID=${resolvedOrgID || 'any'})`);

      } else {
        // ─── FORWARD PATH (Activity → Machinery) ─────────────────────────────────
        const pipeline: any[] = [];

        // Stage 1: Find matching child docs (search term + active flag)
        pipeline.push({ $match: { ...searchClause, ...activeFilter } });

        // Stage 2: Join with the parent collection
        pipeline.push({
          $lookup: {
            from: jt.collection,
            localField: jt.localField,
            foreignField: jt.foreignField,
            as: '_parent',
          },
        });

        // Stage 3: Only keep docs that actually have a parent (inner join)
        pipeline.push({ $unwind: '$_parent' });

        // Stage 4: Apply org/vessel filter on the parent fields
        const parentMatch: Record<string, any> = {};
        if (resolvedOrgID && jt.orgField) {
          parentMatch[`_parent.${jt.orgField}`] = parentMeta.orgType === 'ObjectId'
            ? new ObjectId(resolvedOrgID)
            : resolvedOrgID;
        }
        if (resolvedVesselID && jt.vesselField) {
          parentMatch[`_parent.${jt.vesselField}`] = parentMeta.vesselType === 'ObjectId'
            ? new ObjectId(resolvedVesselID)
            : resolvedVesselID;
        }
        if (Object.keys(parentMatch).length > 0) {
          pipeline.push({ $match: parentMatch });
        }

        // Stage 5: Remove the joined parent field from results and cap
        pipeline.push({ $project: { _parent: 0 } });
        pipeline.push({ $limit: 10 });

        docs = await db.collection(collectionName).aggregate(pipeline).toArray();
        console.log(`[Discovery Engine] 🔗 JoinThrough aggregation for "${collectionName}" via "${jt.collection}": ${docs.length} results (vesselID=${resolvedVesselID || 'any'}, orgID=${resolvedOrgID || 'any'})`);
      }
    } else {
      // Standard find() path — org/vessel scoping already in queryFilter from metadata
      console.log(`[Discovery Engine] 🔍 Standard find() for "${collectionName}": filter=${JSON.stringify(queryFilter)} | searchFields=${JSON.stringify(searchFields)} | searchTerm=${searchTerm}`);
      docs = await db.collection(collectionName).find({
        ...queryFilter,
        ...searchClause,
        ...activeFilter,
      }).limit(10).toArray();
    }

    if (docs.length === 0) {
      console.warn(`[Discovery Engine] ⚠️ No matches in collection "${collectionName}" for "${searchTerm}"`);
      return {
        content: [{
            type: 'text',
            text: JSON.stringify({
              capability: 'mcp.resolve_entities',
              appliedFilters: { entityType, collectionName, searchTerm, organizationID: resolvedOrgID, vesselID: resolvedVesselID },
              items: [],
              message: `No matches found in ${entityType} for "${searchTerm}".`
            })
        }]
      };
    }

    const matches = docs.map(doc => ({
      id: String(doc[idField] || doc._id),
      label: doc[displayField] || doc.name || doc.description || doc.vesselName || "Unnamed",
      type: entityType,
    }));

    console.log(`[Discovery Engine] ✅ Found ${matches.length} matches for "${searchTerm}" in ${collectionName}`);

    return {
      content: [{
          type: 'text',
          text: JSON.stringify({
              capability: 'mcp.resolve_entities',
              appliedFilters: { entityType, collectionName, searchTerm, organizationID: resolvedOrgID, vesselID: resolvedVesselID },
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
  }
  // 🟢 GAP-10: No finally block needed — shared client stays alive between calls.
  // The client is intentionally NOT closed here; it persists for the process lifetime.
}
