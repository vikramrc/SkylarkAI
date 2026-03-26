import { ChatOpenAI } from "@langchain/openai";
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
    const flattenedResults: Record<string, any> = {};
    const rawResults = state.toolResults;
    const turns = Array.isArray(rawResults) ? rawResults : (rawResults ? [rawResults] : []);
    
    turns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, val]) => {
            flattenedResults[key] = val;
        });
    });

    const resultsStr = JSON.stringify(flattenedResults, null, 2);
    const systemPrompt = `You are the Skylark PMS (Planned Maintenance System) Observational Memory Controller.
Based on the Previous Memory and the Latest Tool Results, provide a single consolidated, cumulative context summary (e.g., active vessels, equipment inspected, or list counts) for the investigation trail.
Reference canonical PMS entities where applicable: Vessel, Machinery, Component, ActivityWorkHistory (Work History), InventoryPart (Spares/Parts), Procurement (PurchaseOrder), or Forms.

- **Continuous Session Scope (Critical)**: Always explicitly carry forward and preserve any filtering criteria or bounding context currently driving the session scope (e.g., Organization Name/IDs, specific Vessel Name/IDs, Machinery IDs, Budget Year, or timeframe offsets). Unless explicitly overridden by the user, these remain the implicitly controlling session filters for any subsequent tool calls.

Your output will form the entire rolling Observational Memory buffer for subsequent tool triggers. Keep it extremely concise (5-6 sentences or 6-7 bullet points max) to avoid inflating context token sizes. Do not hallucinate data that wasn't in the tool responses.`;

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
        { role: "user", content: `[Previous Memory]:\n${state.workingMemory?.summaryBuffer || "None"}\n\n[Latest Tool Results]:\n${resultsStr}` }
    ];

    console.log(`\x1b[33m${ts()} [LangGraph UpdateMemory] --- PROMPT SENT TO LLM ---\x1b[0m`);
    console.log(JSON.stringify(promptMessages, null, 2));

    try {
        const response = await model.invoke(promptMessages);

        // 🟢 Log Token Caching Savings
        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("UpdateMemory", response);

        console.log(`[LangGraph UpdateMemory Output]`, response.content);

        const updatedBuffer = response.content ? String(response.content) : state.workingMemory?.summaryBuffer;
        
        const updatedMemory = {
            ...(state.workingMemory || { activeTopics: [], extractedEntities: {} }),
            summaryBuffer: updatedBuffer
        };

        return { workingMemory: updatedMemory };
    } catch (e: any) {
        console.error(`[LangGraph] Failed to update memory buffer`, e);
        return { error: `Update Memory Node failed: ${e.message || String(e)}` };
    }
}
