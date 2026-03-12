import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { skylarkTools } from './tools.js';
import { openai } from '@ai-sdk/openai';

export const skylarkWorkingMemorySchema = z.object({
  userPreferences: z.object({
    role: z.string().describe("E.g., Technical Superintendent, Purchaser").optional(),
    timezone: z.string().optional(),
    currentFocusedVessel: z.string().describe("The vessel they are currently talking about most").optional(),
    orgShortName: z.string().describe("The organization shortname").optional(),
    orgId: z.string().describe("The organization ID").optional(),
  }).optional(),
  plannedMaintenance: z.object({
    activeJobId: z.string().describe("If they are discussing a specific pending job").optional(),
    filterState: z.object({
      criticalOnly: z.boolean().optional(),
      department: z.string().describe("E.g., Deck, Engine").optional(),
    }).optional(),
    recentlyQueriedTags: z.array(z.string()).optional(),
  }).optional(),
  procurement: z.object({
    activePoNumber: z.string().describe("If they are deep-diving a specific PO").optional(),
    pendingRequisitionsCount: z.number().optional(), 
    supplierFocus: z.string().describe("A vendor they are currently analyzing").optional(),
  }).optional(),
  activeTopics: z.array(z.string()).describe("General active topics string array for the LLM to easily glance at").optional(), 
});

export const getSkylarkAgent = (storage?: any) => {

  console.log("[Agent] Initializing Skylark Agent...");
  console.log(`[Agent] Storage provided: ${!!storage}`);
  if (storage) {
    console.log(`[Agent] Storage type: ${storage.constructor.name}`);
  }

    const queryModel = process.env.MASTRA_OPENAI_QUERY_MODEL || 'gpt-4o';
    const reasoning = (process.env.MASTRA_OPENAI_QUERY_MODEL_REASONING as any) || 'low';
    
    const configuredModel = openai(queryModel, { reasoningEffort: reasoning });

    return new Agent({
        id: 'skylark-operator',
        name: 'Skylark Operator',
        instructions: `You are a helpful assistant with access to MCP tools. Help users interact with the MCP server to manage Planned Maintenance, Inventory, and Fleet Operations. 

When you learn an organization name (like "fleetships") or a vessel name, make sure to update your Working Memory so you can use them automatically for future tool calls.`,
        model: configuredModel,
        tools: skylarkTools,
        memory: new Memory({
            storage,
            options: {
                lastMessages: 10,
                observationalMemory: true,
                workingMemory: {
                    enabled: true,
                    schema: skylarkWorkingMemorySchema,
                    // @ts-ignore - Setting scope to thread to avoid resourceId requirement
                    scope: 'thread'
                }
            }
        })
    });
};
