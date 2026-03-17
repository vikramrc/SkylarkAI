import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { SkylarkState } from "../state.js";

/**
 * nodeUpdateMemory aggregates the latest toolResults and updates the workingMemory.summaryBuffer.
 * Configured using dynamic providers mapping from `.env` setups.
 */
export async function nodeUpdateMemory(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] 🧠 Updating Memory Node invoked`);
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

    const resultsStr = JSON.stringify(state.toolResults, null, 2);
    const systemPrompt = `You are the Skylark Memory Controller. 
Based on the latest tool results below, provide a short 1-2 sentence context summary (active entities, vessel triggers) to append to our Observational Memory context. Do not hallucinate.`;

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
        { role: "user", content: `Latest Tool Results:\n${resultsStr}` }
    ];

    console.log(`[LangGraph UpdateMemory] --- PROMPT SENT TO LLM ---`);
    console.log(JSON.stringify(promptMessages, null, 2));

    try {
        const response = await model.invoke(promptMessages);

        console.log(`[LangGraph UpdateMemory Output]`, response.content);

        const updatedBuffer = response.content ? String(response.content) : state.workingMemory.summaryBuffer;
        
        const updatedMemory = {
            ...state.workingMemory,
            summaryBuffer: updatedBuffer
        };

        return { workingMemory: updatedMemory };
    } catch (e: any) {
        console.error(`[LangGraph] Failed to update memory buffer`, e);
        return { error: `Update Memory Node failed: ${e.message || String(e)}` };
    }
}
