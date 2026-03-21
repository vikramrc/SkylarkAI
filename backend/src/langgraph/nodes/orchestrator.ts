import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import axios from "axios";
import https from "https";
import type { SkylarkState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import { getParameterDescription } from "../../mcp/capabilities/contract.js";

// 1. Define Structured Output Schema
export const orchestratorSchema = z.object({
    tools: z.array(z.object({
        name: z.string().describe("The dot-separated tool name (e.g., maintenance.query_status)"),
        args: z.array(z.object({
            key: z.string().describe("The argument key/parameter name (e.g., organizationID)"),
            value: z.union([z.string(), z.number(), z.boolean()]).describe("The value for this parameter")
        })).describe("Arguments for the tool call as key-value pairs.")
    })).describe("List of MCP tool names and their arguments to execute in parallel."),
    feedBackVerdict: z.enum(['SUMMARIZE', 'FEED_BACK_TO_ME']).describe("Decide whether the results should be fed back for sequential chain investigation or passed straight to the Summarizer."),
    clarifyingQuestion: z.string().describe("Use this to Ask the user a question if mandatory parameters (e.g., Organization ID/Name) are missing and no tools can be called.").nullable(),
    reasoning: z.string().describe("Quick thought process supporting the tool picks.")
});

// 🟢 Global Module-Level Cache for multitenant startup-once speedups
let capabilitiesCache: any[] = [];
let capabilitiesLoadPromise: Promise<any[]> | null = null;

async function getCapabilitiesCached(backendUrl: string, params: any): Promise<any[]> {
    if (capabilitiesCache.length > 0) return capabilitiesCache;
    if (capabilitiesLoadPromise) return capabilitiesLoadPromise;

    console.log(`\x1b[36m[Orchestrator] 📄 Loading capabilities cache for the first time...\x1b[0m`);
    capabilitiesLoadPromise = (async () => {
        try {
            const https = await import('https');
            const axios = (await import('axios')).default;
            const response = await axios.get(`${backendUrl}/api/mcp/capabilities`, {
                params,
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            });
            capabilitiesCache = (response.data.capabilities || [])
                .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
            console.log(`\x1b[32m[Orchestrator] ✅ Loaded ${capabilitiesCache.length} capabilities into global cache\x1b[0m`);
        } catch (error: any) {
            console.error("[LangGraph Orchestrator] Failed to fetch raw capabilities:", error.message);
            capabilitiesLoadPromise = null; // 🟢 Clear promise lock so next requests can retry
        }
        return capabilitiesCache;
    })();

    return capabilitiesLoadPromise;
}

export async function nodeOrchestrator(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] ▶ Orchestrator Node invoked (Iteration: ${state.iterationCount || 0})`);
    
    const model = new ChatOpenAI({
        modelName: process.env.MASTRA_ORCHESTRATOR_MODEL || "gpt-5-mini",
    }).withStructuredOutput(orchestratorSchema, { includeRaw: true } as any);

    const memoryContext = state.workingMemory?.summaryBuffer 
        ? `\n[Context from Previous Moves]: ${state.workingMemory.summaryBuffer}` 
        : "";

    const systemInstruction = `You are a professional maritime operations orchestrator with access to MCP tools. Your goal is to provide accurate, data-driven insights by effectively utilizing the connected MCP infrastructure. Provide solutions based on context guidelines below:

### COLLABORATIVE PROBLEM-SOLVING STRATEGY
1. **Analyze Capabilities First**: Before choosing a tool, evaluate the tool descriptions in your context. Match the technical intent (Maintenance, Procurement, Budget, Voyage etc.) to the specific tool interfaces provided.
2. **Canonical ID Discovery Protocol**: Many deep-dive analysis tools require system IDs (Machinery IDs, Cost Center IDs, etc.).
   - **Step A**: If you have a name but lack an ID, use an "Overview" or "Status" tool to resolve the canonical ID.
   - **Step B**: Only proceed to data-heavy analysis tools once you have verified the correct IDs. NEVER guess or hallucinate IDs.
3. **Multi-Step Reasoning**: Complex queries often require sequencing. Execute tools in logical order: Discovery -> Retrieval -> Enrichment.
4. **Descriptive Name Resolution**: If a user asks for "details" or "names" of an entity but you only have its numerical \`_id\` (e.g., \`vesselID\`), you MUST also invoke lookups that return labels (like \`fleet.query_overview\` for vessels) in parallel, ensuring a user-friendly readable report.

### OPERATIONAL BEST PRACTICES
- **Mandatory Parameter Guard**: If a tool requires a MANDATORY parameter that you do not have in context or working memory, DO NOT invoke the tool.
- **Organization Identifier Guard**: Most tool endpoints REQUIRE an Organization identifier scope ('organizationShortName', 'organizationName', or 'organizationID'). If you lack ALL of these in memory context, you MUST use 'clarifyingQuestion' to ask the user for it first, instead of invoking tools listed.
- **Failback Management**: If a specialized MCP tool returns an error or empty result, use the 'direct_query_fallback' as a high-fidelity semantic backup if available.
- **Max Record Count**: Any tool that queries lists has a hard limit of 100 records maximum. Set 'limit' parameters to 100 or less on all invocations.

### 🛠️ AVAILABLE MCP TOOLS
%%TOOL_CONTEXT%%
`;

    const isSequentialTurn = (state.iterationCount || 0) > 0;
    const sequentialInstruction = isSequentialTurn 
        ? `\n\n### 🔄 SEQUENTIAL INVESTIGATION (Iterative Turn)
You are acting as a **Maritime Technical Superintendent** with vast experience in **Planned Maintenance Systems (PMS)**. 
You are currently on a follow-up turn investigating further based on previous tool results in memory.
1. Evaluate what was found vs the gaps remaining.
2. DO NOT repeat the exact same tool calls with the same parameters if they returned empty/complete results.
3. If no further tool calls can help, set 'feedBackVerdict' to 'SUMMARIZE' to wrap up.`
        : "";
        
    const backendUrl = process.env.PHOENIX_CLOUD_URL || 'https://localhost:3000';
    const params = { organizationID: process.env.PHOENIX_CLOUD_ORGANIZATION_ID || "" };
    
    // 🟢 Use Global Cache flawlessly triggers
    const baseCapabilitiesContract = await getCapabilitiesCached(backendUrl, params);


    const toolDetails = baseCapabilitiesContract.map((c: any) => {
        // Fetch canonical required/optional queries before normalization just to render detail
        const reqStr = (c.requiredQuery || []).map((p: string) => `${p}: ${getParameterDescription(p, c.requiredQuery || [])}`).join("\n    ");
        const optStr = (c.optionalQuery || []).map((p: string) => `${p}: ${getParameterDescription(p, c.requiredQuery || [])}`).join("\n    ");

        return `- **${c.name}**
  * Purpose: ${c.purpose}
  * Required Params:
    ${reqStr || "None"}
  * Optional Params:
    ${optStr || "None"}
  * Typical Questions: ${c.typicalQuestions?.map((q: string) => `"${q}"`).join(", ") || "None"}
  * Response Shape: [${c.responseShape?.join(", ") || ""}]
  * Guidance: ${c.interpretationGuidance || "None"}`;
    }).join("\n\n");

    // 🟢 Append local direct_query_fallback tool flawlessly flaws
    const finalToolDetails = `${toolDetails}\n\n- **direct_query_fallback**
  * Purpose: Use this tool for general queries, complex aggregations, or when no other specific MCP tool covers the request (e.g., details on Forms, Crew, Budget, Voyage, or machinery logs). Performs a direct semantic search and MongoQL query against the database.
  * Required Params:
    userQuery: The user's original query or a refined version for database searching.
  * Optional Params:
    None
  * Response Shape: [success, source, data]
  * Guidance: If specialized filtering endpoints do not match target granularity or fail to return field-level items, call this as high-fidelity failback seamlessly flawlessly.`;

    const formattedInstruction = systemInstruction.replace("%%TOOL_CONTEXT%%", finalToolDetails);

    const promptMessages = [
        { role: "system", content: formattedInstruction } as any, 
    ];

    if (memoryContext || sequentialInstruction) {
        promptMessages.push({ 
            role: "system", 
            content: `\n### OBSERVATIONAL MEMORY CONTEXT\n${memoryContext}${sequentialInstruction}` 
        } as any);
    }

    promptMessages.push(...state.messages);

    console.log(`[LangGraph Orchestrator] --- PROMPT SENT TO LLM ---`);
    const promptJson = JSON.stringify(promptMessages, null, 2);
    const coloredLogs = promptJson
        .replace(/"### OBSERVATIONAL MEMORY CONTEXT\\n"/g, `"\x1b[35m### OBSERVATIONAL MEMORY CONTEXT\x1b[0m\\n"`)
        .replace(/\\n\[Context from Previous Moves\]:/g, `\\n\x1b[36m[Context from Previous Moves]\x1b[0m:`)
        .replace(/### 🔄 SEQUENTIAL INVESTIGATION/g, `\x1b[35m### 🔄 SEQUENTIAL INVESTIGATION\x1b[0m`);
    
    console.log(coloredLogs);

    let response: any;
    let result: any;
    try {
        result = await model.invoke(promptMessages);
        response = result.parsed;

        // 🟢 Log Token Caching Savings
        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("Orchestrator", result);
    } catch (error: any) {
        console.error(`[LangGraph Orchestrator] LLM Invoke crashed:`, error.message);
        return { error: `Orchestrator Node crashed: ${error.message}` };
    }

    console.log(`[LangGraph Orchestrator Output]`, JSON.stringify(response, null, 2));
    console.log(`[LangGraph]   Verdict: ${response.feedBackVerdict} | Tools: ${JSON.stringify(response.tools.map((t: any) => t.name))}`);

    const updates: Partial<SkylarkState> = {
        toolCalls: response.tools,
        feedBackVerdict: response.feedBackVerdict,
        iterationCount: (state.iterationCount || 0) + 1,
        hitl_required: undefined, // 🟢 Clear previous checkpoints flags breakouts!
        error: undefined // 🟢 Clear previous turn errors carry over flawless flawlessly index flaws!
    };

    // If there is a clarifying question, append it to messages so the Summarizer can look at it
    if (response.clarifyingQuestion) {
        updates.messages = [new AIMessage(response.clarifyingQuestion)];
        // Force verdict to SUMMARIZE if we are asking a question to break execution loop
        updates.feedBackVerdict = 'SUMMARIZE';
        updates.hitl_required = true; // 🟢 MARK HITL REQUIRED execution pauses breakouts flawless!
        updates.toolCalls = []; // empty tools so conditional edge jumps to summarizer
    }

    return updates;
}
