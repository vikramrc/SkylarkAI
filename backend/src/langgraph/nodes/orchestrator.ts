import { ChatOpenAI } from "@langchain/openai";
import { injectMaritimeKnowledge } from "../utils/knowledge_loader.js";
import { loadOrchestratorPrompt } from "../utils/prompt_loader.js";
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
        uiTabLabel: z.string().describe("A short, user-friendly title for this tool's UI tab, summarizing the context or specific filters applied (e.g., 'Overdue Tasks', 'Global Checklists', 'Deck Operations')."),
        confidence: z.number().min(0).max(1).describe("Your confidence in this tool call (0.0 to 1.0). Use < 0.6 if you are guessing; >= 0.9 if you are grounded in a verified ID."),
        args: z.array(z.object({
            key: z.string().describe("The argument key/parameter name (e.g., organizationID)"),
            value: z.union([z.string(), z.number(), z.boolean()]).describe("The value for this parameter")
        })).describe("Arguments for the tool call as key-value pairs.")
    })).describe("List of MCP tool names and their arguments to execute in parallel."),
    feedBackVerdict: z.enum(['SUMMARIZE', 'FEED_BACK_TO_ME']).describe("Decide whether the results should be fed back for sequential chain investigation or passed straight to the Summarizer."),
    clarifyingQuestion: z.string().describe("Use this to Ask the user a question if mandatory parameters (e.g., Organization ID/Name) are missing and no tools can be called.").nullable(),
    reasoning: z.string().describe("Your internal technical thought process. If you pick FEED_BACK_TO_ME, explain exactly what gap you are trying to fill (e.g., 'Fetched Job IDs, now need to fetch their specific form contents' or 'Direct query failed, trying standard tool fallback')."),
    selectedResultKeys: z.array(z.string()).describe("A list of specific tool result keys (e.g., 'maintenance.query_status_iter2_0') from previous turns that you want to promote to the final answer and UI. If provided, the system will ONLY summarize and show these tools. Use this to skip re-running tools you already have data for.")
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
        modelName: process.env.MASTRA_ORCHESTRATOR_QUERY_MODEL || "gpt-5-mini",
    }).withStructuredOutput(orchestratorSchema, { includeRaw: true } as any);

    const memoryBuffer = state.workingMemory?.summaryBuffer || "";
    const history = Array.isArray(state.toolResults) ? state.toolResults : (state.toolResults ? [state.toolResults] : []);
    const currentTurns = history.slice(state.startTurnIndex || 0);

    // 🟢 CONDUCTOR CONTEXT: Show the LLM a history of ALL tools fetched in this request so it can 'Point' to them.
    let resultsContext = "";
    const toolLines: string[] = [];
    
    currentTurns.forEach((turn: any, tIdx: number) => {
        const iterNum = (state.startTurnIndex || 0) + tIdx + 1; // 1-indexed human turn count flawless!
        Object.entries(turn || {}).forEach(([key, res]) => {
            let data: any = res;
            if (data?.content?.[0]?.text) {
                try { 
                    const text = data.content[0].text;
                    if (text.trim().startsWith('{')) data = JSON.parse(text); 
                } catch {}
            }
            const label = data?.uiTabLabel || key;
            const items = Array.isArray(data?.items) ? data.items : [];
            const count = items.length;
            
            const filters = data?.appliedFilters || {};
            const filterParts = Object.entries(filters)
                .filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'organizationID')
                .map(([k, v]) => `${k}:${v}`);
            const fLabel = filterParts.length > 0 ? ` [filters: ${filterParts.join(', ')}]` : '';

            // Per-tool counts if available (Restored for high-fidelity reasoning)
            const overdue = items.filter((i: any) => i?.isOverdue === true || i?.statusCode === 'overdue').length;
            const upcoming = items.filter((i: any) => i?.isUpcoming === true || i?.statusCode === 'upcoming').length;
            const totalAvailable = data?.summary?.overdueCount !== undefined
                ? `total available: overdue=${data.summary.overdueCount} upcoming=${data.summary.upcomingCount}`
                : '';

            let line = `- Key: "${key}" | Label: "${label}"${fLabel} | Count: ${count} items (Turn ${iterNum})`;
            if (count === 0) {
                line += ` | ⚠️ EMPTY — no matching records exist for this vessel+filter`;
            } else {
                if (overdue > 0 || upcoming > 0) line += ` | returned: overdue=${overdue}, upcoming=${upcoming}`;
                if (totalAvailable) line += ` | ${totalAvailable}`;
                if (count < 2 && count > 0) line += ` | ⚠️ only ${count} match exists — database has no more records for this vessel+filter`;
            }
            toolLines.push(line);
        });
    });

    if (toolLines.length > 0) {
        resultsContext = `\n\n### PREVIOUS TOOL RESULTS IN THIS REQUEST:\n${toolLines.join('\n')}\n\n(Consult the 'DEDUPLICATION & CONDUCTOR RULES' in your system instructions for how to handle these results.)`;
    }

    // 🟢 SESSION DECISION JOURNAL: Parse messages and tool results to create a causal log of THIS query cycle only.
    const journalEntries: string[] = [];
    const messages = state.messages || [];
    const questionTurns = messages.slice(state.startTurnIndex || 0);

    // Initialize the journal with the user's initial query in this session
    let currentEntry: { question?: string; answer?: string; tools: string[] } | null = null;
    if (questionTurns.length > 0) {
        const firstMsg = questionTurns[0] as any;
        const type = firstMsg._getType?.() || firstMsg.role || 'human';
        if (type === 'human') {
            currentEntry = { question: firstMsg.content, tools: [] };
        }
    }

    questionTurns.forEach((msg, idx) => {
        const type = (msg as any)._getType?.() || (msg as any).role || 'human';
        if (type === 'ai' && (msg as any).content) {
            const content = (msg as any).content;
            // A clarifying question usually contains a "?" or marks a new conversational turn
            if (content.includes("?") || idx > 0) {
                if (currentEntry) {
                    journalEntries.push(`? Q: ${currentEntry.question || 'Initial Query'}\n✓ A: ${currentEntry.answer || 'Proceeding'}\n🚀 Actions: ${currentEntry.tools.join(', ') || 'None'}`);
                }
                currentEntry = { question: content, tools: [] };
            }
        } else if (type === 'human' && idx > 0) {
            // This is an answer to a previous AI question
            if (currentEntry) currentEntry.answer = (msg as any).content;
        }
    });

    // Match tools into the journal entries
    currentTurns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, res]: [string, any]) => {
            const filters = (res as any)?.appliedFilters || {};
            const filterStr = Object.entries(filters).filter(([k,v]) => v).map(([k,v]) => `${k}:${v}`).join(',');
            const entryStr = `${key}(${filterStr})`;
            if (currentEntry) {
                currentEntry.tools.push(entryStr);
            }
        });
    });

    if (currentEntry) {
        journalEntries.push(`? Q: ${currentEntry.question || 'Query Content'}\n✓ A: ${currentEntry.answer || 'Finalizing'}\n🚀 Actions: ${currentEntry.tools.length > 0 ? currentEntry.tools.join(', ') : 'None'}`);
    }

    const decisionJournal = journalEntries.length > 0 
        ? `\n\n### 📓 SESSION DECISION JOURNAL (Current Query Only):\n${journalEntries.join('\n---\n')}\n\n**MANDATE**: You MUST consult this Journal. If a question was answered or a Tool+Parameter combination was already executed, you are FORBIDDEN from repeating it.`
        : "";

    const memoryContext = memoryBuffer || resultsContext || decisionJournal
        ? `\n[Context from Previous Moves]: ${memoryBuffer}${resultsContext}${decisionJournal}` 
        : "";


    const systemInstruction = loadOrchestratorPrompt();

    const iterationCount = state.iterationCount || 0;
    const isSequentialTurn = iterationCount > 0;
    const sequentialInstruction = isSequentialTurn 
        ? `\n\n### 🔄 SYSTEM FLAG: ITERATIVE TURN\nYou are currently on follow-up turn #${iterationCount}. Consult the 'TERMINATION & DEDUPLICATION' guidelines in your constitution to determine if further retrieval is necessary.`
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
  * When to Use: ${c.whenToUse || "None"}
  * When NOT to Use: ${c.whenNotToUse || "None"}
  * Interpretation Guidance: ${c.interpretationGuidance || "None"}`;
    }).join("\n\n");

    // 🟢 Append local direct_query_fallback tool flawlessly flaws
    const finalToolDetails = `${toolDetails}\n\n- **direct_query_fallback**
  * Purpose: Direct database search and MongoQL query. Use this only when no other specific MCP tool endpoint matches the required filters or data scope.
  * Required Params:
    userQuery: The precise natural language dataset query to search against the Phoenix database.
  * Optional Params:
    None
  * Response Shape: [success, source, data]`;

    const formattedInstruction = systemInstruction.replace("%%TOOL_CONTEXT%%", finalToolDetails);

    const promptMessages = [
        { role: "system", content: formattedInstruction } as any, 
    ];

    if (memoryContext || sequentialInstruction || decisionJournal) {
        promptMessages.push({ 
            role: "system", 
            content: `\n### OBSERVATIONAL MEMORY CONTEXT\n${memoryContext}${sequentialInstruction}${decisionJournal}` 
        } as any);
    }

    promptMessages.push(...state.messages);

    console.log(`\x1b[36m[LangGraph Orchestrator] --- PROMPT SENT TO LLM ---\x1b[0m`);
    const promptJson = JSON.stringify(promptMessages, null, 2);
    
    // 🟢 Console Visibility Optimization: Hollow out stagnant system instructions flawlessly!
    const consoleFormatted = promptJson
        .replace(
            /"# 🏗️ THE MARITIME SUPERINTENDENT[\s\S]*?### 🛠️ AVAILABLE MCP TOOLS/g,
            `"[... Stagnant System Instructions Hidden for Brevity ...]\n\n### 🛠️ AVAILABLE MCP TOOLS`
        )
        .replace(
            /### 🛠️ AVAILABLE MCP TOOLS[\s\S]*?### OBSERVATIONAL MEMORY CONTEXT/g,
            `### 🛠️ AVAILABLE MCP TOOLS\n\n[... ${baseCapabilitiesContract.length} Tool Descriptions Hidden for Brevity ...]\n\n### OBSERVATIONAL MEMORY CONTEXT`
        );

    const coloredLogs = consoleFormatted
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
        const { logLLMError } = await import("../utils/logger.js");
        logLLMError("Orchestrator", error);
        return { error: `Orchestrator Node crashed: ${error.message}` };
    }

    console.log(`[LangGraph Orchestrator Output]`, JSON.stringify(response, null, 2));
    
    if (!response) {
        console.error(`[LangGraph Orchestrator] 🚨 LLM returned null or invalid structured data. Check prompt and token limits.`);
        return { error: `Orchestrator failed to generate a valid plan. This often happens on very long conversations or when token limits are reached. Please try clearing the chat or asking a simpler question.` };
    }

    console.log(`[LangGraph Orchestrator] Verdict: ${response.feedBackVerdict} | Tools Requested: ${JSON.stringify(response.tools.map((t: any) => `${t.name} (conf: ${t.confidence})`))} | Selection: ${JSON.stringify(response.selectedResultKeys)}`);

    const updates: Partial<SkylarkState> = {
        toolCalls: response.tools,
        feedBackVerdict: response.feedBackVerdict,
        reasoning: response.reasoning, // 🟢 Save technical reasoning for diagnostics flawlessly!
        iterationCount: (state.iterationCount || 0) + 1,
        hitl_required: undefined, // 🟢 Clear previous checkpoints flags breakouts!
        error: undefined, // 🟢 Clear previous turn errors carry over flawless flawlessly index flaws!
        selectedResultKeys: response.selectedResultKeys || [] // 🟢 Save Conductor's tool choices flawlessly!
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
