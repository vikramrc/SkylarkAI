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

export async function nodeOrchestrator(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] ▶ Orchestrator Node invoked (Iteration: ${state.iterationCount || 0})`);
    
    const model = new ChatOpenAI({
        modelName: process.env.MASTRA_ORCHESTRATOR_MODEL || "gpt-5-mini",
    }).withStructuredOutput(orchestratorSchema);

    const memoryContext = state.workingMemory.summaryBuffer 
        ? `\n[Context from Previous Moves]: ${state.workingMemory.summaryBuffer}` 
        : "";

    const systemInstruction = `You are a professional maritime operations orchestrator with access to MCP tools. Your goal is to provide accurate, data-driven insights by effectively utilizing the connected MCP infrastructure. Provide solutions based on context guidelines below:

### COLLABORATIVE PROBLEM-SOLVING STRATEGY
1. **Analyze Capabilities First**: Before choosing a tool, evaluate the tool descriptions in your context. Match the technical intent (Maintenance, Procurement, Budget, Voyage etc.) to the specific tool interfaces provided.
2. **Canonical ID Discovery Protocol**: Many deep-dive analysis tools require system IDs (Machinery IDs, Cost Center IDs, etc.).
   - **Step A**: If you have a name but lack an ID, use an "Overview" or "Status" tool to resolve the canonical ID.
   - **Step B**: Only proceed to data-heavy analysis tools once you have verified the correct IDs. NEVER guess or hallucinate IDs.
3. **Multi-Step Reasoning**: Complex queries often require sequencing. Execute tools in logical order: Discovery -> Retrieval -> Enrichment.

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
    // 🟢 Fetch raw capabilities directly from the backend to preserve ALL keys (Guidance, Shapes, Options)
    const backendUrl = process.env.PHOENIX_CLOUD_URL || 'https://localhost:3000';
    const params = { organizationID: process.env.PHOENIX_CLOUD_ORGANIZATION_ID || "" };
    
    let baseCapabilitiesContract: any[] = [];
    try {
        const response = await axios.get(`${backendUrl}/api/mcp/capabilities`, {
            params,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        baseCapabilitiesContract = response.data.capabilities || [];
    } catch (error: any) {
        console.error("[LangGraph Orchestrator] Failed to fetch raw capabilities:", error.message);
    }

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
    const formattedInstruction = systemInstruction.replace("%%TOOL_CONTEXT%%", toolDetails);

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
    console.log(JSON.stringify(promptMessages, null, 2));

    let response: any;
    try {
        response = await model.invoke(promptMessages);
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
        hitl_required: undefined // 🟢 Clear previous checkpoints flags breakouts!
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
