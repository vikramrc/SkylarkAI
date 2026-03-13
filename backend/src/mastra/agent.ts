import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { skylarkTools } from './tools.js';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { deepseek } from '@ai-sdk/deepseek';

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
    
    console.log(`[Agent] Initializing with Query Model: ${queryModel} (${reasoning})`);
    const configuredModel = openai(queryModel);

    return new Agent({
        id: 'skylark-operator',
        name: 'Skylark Operator',
        instructions: `You are a maritime Technical Superintendent and  professional maritime operations orchestrator with access to MCP tools. Your goal is to provide accurate, data-driven insights by effectively utilizing the connected MCP infrastructure.

### COLLABORATIVE PROBLEM-SOLVING STRATEGY
1. **Analyze Capabilities First**: Before choosing a tool, evaluate the tool descriptions in your context. Match the user's technical intent (Maintenance, Procurement, Budget, Voyage etc.) to the specific tool interfaces provided.
2. **Canonical ID Discovery Protocol**: Many deep-dive analysis tools require system IDs (Machinery IDs, Cost Center IDs, etc.).
   - **Step A**: If you have a name but lack an ID, use an "Overview" or "Status" tool to resolve the canonical ID.
   - **Step B**: Only proceed to data-heavy analysis tools once you have verified the correct IDs. NEVER guess or hallucinate IDs.
3. **Multi-Step Reasoning**: Complex queries often require sequencing. Execute tools in logical order: Discovery -> Retrieval -> Enrichment.

### OPERATIONAL BEST PRACTICES
- **Dynamic Context**: Update your Working Memory whenever you identify the primary entities (Organization, Vessel, Fleet) for the current session.
- **Failback Management**: If a specialized MCP tool returns an error or empty result, use the 'direct_query_fallback' as a high-fidelity semantic backup to ensure the user gets an answer.
- **Data Integrity**: Present lists and technical dates in clear, professional formats. Verify units (Currency, Timezones) when available in the tool output.

Your tone should be efficient, technically accurate, and helpful.`,
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

/**
 * Resolves a separate summarizer model if MASTRA_SUMMARIZER_PROVIDER is configured.
 * Otherwise returns the main model used for querying.
 */
export const getSummarizerModel = (): any => {
    const provider = process.env.MASTRA_SUMMARIZER_PROVIDER;
    const model = process.env.MASTRA_SUMMARIZER_MODEL;
    const reasoning = (process.env.MASTRA_SUMMARIZER_MODEL_REASONING as any) || 'low';

    if (provider === 'openai' && model) {
        console.log(`[Agent] Initializing independent summarizer model (OpenAI): ${model} (${reasoning})`);
        return openai(model);
    }

    if (provider === 'google' && model) {
        console.log(`[Agent] Initializing independent summarizer model (Google): ${model}`);
        return google(model);
    }

    if (provider === 'anthropic' && model) {
        console.log(`[Agent] Initializing independent summarizer model (Anthropic): ${model}`);
        return anthropic(model);
    }

    if (provider === 'deepseek' && model) {
        console.log(`[Agent] Initializing independent summarizer model (DeepSeek): ${model}`);
        return deepseek(model);
    }

    // Default to query model if no specific summarizer is configured
    const queryModel = process.env.MASTRA_OPENAI_QUERY_MODEL || 'gpt-4o';
    return openai(queryModel);
};
