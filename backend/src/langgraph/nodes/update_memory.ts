import { ChatOpenAI } from "@langchain/openai";
import { injectMaritimeKnowledge } from "../utils/knowledge_loader.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { SkylarkState } from "../state.js";

/**
 * nodeUpdateMemory aggregates the latest toolResults and updates the workingMemory.summaryBuffer.
 * Configured using dynamic providers mapping from `.env` setups.
 */
export async function nodeUpdateMemory(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const ts = () => `[${new Date().toISOString().substring(11, 19)}]`;
    console.log(`\x1b[33m${ts()} [LangGraph] 🧠 Updating Memory Node invoked\x1b[0m`);
    const provider = process.env.MASTRA_SUMMARIZER_PROVIDER || 'openai';
    const modelName = process.env.MASTRA_SUMMARIZER_MODEL || 'gpt-5-mini';

    let model: any;

    if (provider === 'openai') {
        model = new ChatOpenAI({
            modelName: modelName,
        });
    } else if (provider === 'google') {
        model = new ChatGoogleGenerativeAI({
            model: modelName,
            apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "", // Guarantee safe string fallback
        });
    } else {
        // Dynamic scaling support structure for Google/Anthropic once @langchain drivers installed
        throw new Error(`[LangGraph] Provider '${provider}' not fully implemented for UpdateMemory Node. Please install @langchain/${provider} to enable.`);
    }

    // 🟢 Parallelization Support: toolResults is now an array of turns. 
    // Flatten into a single dictionary for the Memroy LLM to process flawlessly!
    // 🟢 Request Isolation Fix: Use startTurnIndex to ignore stale results from previous queries flawlessly!
    // This prevents the Memory Orchestrator from "drowning" in old JSON history and hitting token limits.
    const rawResults = state.toolResults;
    const history = Array.isArray(rawResults) ? rawResults : (rawResults ? [rawResults] : []);
    const currentTurns = history.slice(state.startTurnIndex || 0);

    const flattenedResults: Record<string, any> = {};
    currentTurns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, val]) => {
            flattenedResults[key] = val;
        });
    });

    const resultsStr = JSON.stringify(flattenedResults, null, 2);
    const systemPrompt = `You are the Skylark PMS (Planned Maintenance System) Observational Memory Controller.
Based on the Previous Memory and the Latest Tool Results, produce a **cumulative, entity-level context summary** for the investigation trail.

${injectMaritimeKnowledge()}

- **Continuous Session Scope (Critical)**: Always explicitly carry forward and preserve any filtering criteria or bounding context currently driving the session scope (e.g., Organization Name/IDs, specific Vessel Name/IDs, Machinery IDs, Budget Year, or timeframe offsets). Unless explicitly overridden by the user, these remain the implicitly controlling session filters for any subsequent tool calls.

- **Entity-Level Retention (Critical)**: You MUST preserve entity-specific details at the row level:
  - For each **Vessel**: retain its name, IDs, and any per-vessel counts (overdue, upcoming, completed).
  - For any **Machinery, Component, Activity**: retain returned names, IDs, and status flags. **Maintain the hierarchy** (e.g., which activity belongs to which machinery).
  - For any **InventoryPart, PurchaseOrder, Form**: retain returned names, part numbers, or form IDs.
  - Do NOT collapse vessel-specific counts into a single fleet total if individual vessel data was returned.

- **Foreign Key Surface (Critical)**: You MUST explicitly list all unique IDs ('performerID', 'vesselID', 'partID', 'activityID', 'machineryID') found in the Latest Tool Results. If only a few exist, list them; if many exist, confirm they are "captured and ready for enrichment". This prevents the system from re-calling discovery tools.

- **Do NOT omit data already in memory** unless the latest tool results explicitly correct or supersede it.

Your output will form the entire rolling Observational Memory buffer for subsequent tool triggers. Aim for 10-15 focused bullet points. Avoid padding or generic phrases.`;

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
        { role: "user", content: `[Previous Memory]:\n${state.workingMemory?.queryContext?.lastTurnInsight || "None"}\n\n[Latest Tool Results]:\n${resultsStr}` }
    ];

    console.log(`\x1b[33m${ts()} [LangGraph UpdateMemory] --- PROMPT SENT TO LLM ---\x1b[0m`);
    // console.log(JSON.stringify(promptMessages, null, 2));

    try {
        const response = await model.invoke(promptMessages);

        // 🟢 Log Token Caching Savings
        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("UpdateMemory", response);

        console.log(`[LangGraph UpdateMemory Output]`, response.content);

        const updatedBuffer = response.content ? String(response.content) : state.workingMemory?.queryContext?.lastTurnInsight;
        
        const updatedMemory = {
            ...(state.workingMemory || { sessionContext: { scope: {}, resolvedEntities: {} }, queryContext: { rawQuery: "", pendingIntents: [], activeFilters: {}, lastTurnInsight: "" } }),
            queryContext: {
                ...(state.workingMemory?.queryContext || {}),
                lastTurnInsight: updatedBuffer || "",
            }
        };

        return { workingMemory: updatedMemory };
    } catch (e: any) {
        const { logLLMError } = await import("../utils/logger.js");
        logLLMError("UpdateMemory", e);
        return { error: `Update Memory Node failed: ${e.message || String(e)}` };
    }
}
