import { capabilitiesContract } from "./contract.js";
import { proxyToolCall } from "../proxy.js";

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
  
  console.log(`[Discovery Engine] Resolving ${entityType} for term: "${searchTerm}"`);

  // Map entityType to the best discovery tool in the contract
  const mapping: Record<string, { toolName: string; searchFields: string[]; idField: string; labelField: string }> = {
    budget: { 
      toolName: "budget_query_overview", 
      searchFields: ["code", "name"], 
      idField: "_id", // A Budget resolution should return the Budget ID
      labelField: "name" 
    },
    cost_center: { 
      toolName: "budget_query_overview", 
      searchFields: ["costCenter.code", "costCenter.name"], 
      idField: "costCenter._id", // budget.query_overview nests cost center as costCenter.{_id, code, name}
      labelField: "costCenter.name" 
    },

    budget_code: { 
      toolName: "budget_query_overview", // Assuming it returns budgetCode mappings
      searchFields: ["budgetCode", "budgetCodeName"], 
      idField: "budgetCodeID", 
      labelField: "budgetCodeName" 
    },
    machinery: { 
      toolName: "fleet_query_machinery_status", 
      searchFields: ["name", "modelNumber"], 
      idField: "machineryID", 
      labelField: "name" 
    },
    activity: { 
      toolName: "maintenance_query_status", 
      searchFields: ["description"], 
      idField: "activityID", 
      labelField: "description" 
    },
    part: { 
      toolName: "inventory_query_stock_position", 
      searchFields: ["name", "partNumber", "description"], 
      idField: "partID", 
      labelField: "name" 
    },
    vendor: { 
      toolName: "procurement_query_vendor_performance", 
      searchFields: ["vendorName", "vendorCode"], 
      idField: "vendorID", 
      labelField: "vendorName" 
    },
    crew: { 
      toolName: "crew_query_members", 
      searchFields: ["firstName", "lastName", "rankName"], 
      idField: "crewMemberID", 
      labelField: "rankName" // We return rank for PII reasons, but we search by name
    },
    vessel: { 
      toolName: "fleet_query_overview", 
      searchFields: ["vesselName"], 
      idField: "vesselID", 
      labelField: "vesselName" 
    },
    form_template: {
      toolName: "forms_query_status",
      searchFields: ["templateName"],
      idField: "templateID",
      labelField: "templateName"
    }
  };

  const config = mapping[entityType];
  if (!config) {
    return {
      content: [{ type: "text", text: `Error: Unsupported entityType "${entityType}".` }],
      isError: true
    };
  }

  // 1. Get the tool definition
  const toolDef = capabilitiesContract.find(c => c.name.replace(/[.]/g, '_') === config.toolName);
  if (!toolDef) {
    return {
      content: [{ type: "text", text: `Error: Discovery tool "${config.toolName}" not found in contract.` }],
      isError: true
    };
  }

  // 2. Proxy the call to get the data
  // We remove the specific ID from args to get the broad list
  const proxyArgs = { organizationID, organizationShortName, organizationName, vesselID, vesselName, limit: "100" };
  const proxyResult = await proxyToolCall(
    {
      ...toolDef,
      _originalPath: toolDef.path,
      _originalMethod: toolDef.method,
    }, 
    proxyArgs, 
    token
  );

  if (proxyResult.isError) return proxyResult;

  // 3. Parse and Filter
  try {
    if (!proxyResult.content || !proxyResult.content[0]) {
      throw new Error("No content received from discovery tool.");
    }
    const data = JSON.parse(proxyResult.content[0].text);
    const items = data.items || data.results || [];
    
    if (!Array.isArray(items)) {
      throw new Error("Invalid response format: 'items' is not an array.");
    }

    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Helper to resolve dot-notation paths (e.g., 'costCenter.code') from nested objects
    const getNestedValue = (obj: any, path: string): any => {
      return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    };
    
    const matches = items.filter((item: any) => {
      if (!config) return false;
      return config.searchFields.some(field => {
        const val = getNestedValue(item, field);
        if (typeof val === 'string' && regex.test(val)) {
          console.log(`[Discovery Engine] 🔍 Match found in ${field}: "${val}"`);
          return true;
        }
        return false;
      });
    }).map((item: any) => ({
      id: getNestedValue(item, config!.idField) || item._id,
      label: getNestedValue(item, config!.labelField) || item.name || item.description || "Unnamed",
      type: entityType,
      matchField: config!.searchFields.find(f => getNestedValue(item, f) && regex.test(String(getNestedValue(item, f))))
    }));

    if (matches.length === 0) {
      console.warn(`[Discovery Engine] ⚠️ No matches found for "${searchTerm}" in ${entityType}`);
      return {
        content: [{ type: "text", text: `No matches found for "${searchTerm}". Please try a different term or check your spelling.` }]
      };
    }

    console.log(`[Discovery Engine] ✅ Found ${matches.length} matches for "${searchTerm}"`);
    return {
      content: [{ type: "text", text: JSON.stringify({
        success: true,
        entityType,
        searchTerm,
        matches: matches.slice(0, 5) // Limit to top 5 hits
      }) }]
    };

  } catch (err: any) {
    console.error(`[Discovery Engine] Error processing ${entityType} search:`, err);
    return {
      content: [{ type: "text", text: `Error parsing discovery results: ${err.message}` }],
      isError: true
    };
  }
}
