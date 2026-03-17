import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { SkylarkState } from "../state.js";
import { prepareMongoForLLM } from "../../phoenixai/runtime/executor.js";

/**
 * nodeSummarizer aggregates the toolResults into a final user-facing pretty report.
 */
export async function nodeSummarizer(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] 📝 Summarizer Node invoked`);
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
        throw new Error(`[LangGraph] Provider '${provider}' not fully implemented for Summarizer Node. Please install @langchain/${provider} to enable.`);
    }

    // 1. Prepare Schema Context aggregate
    const results = Object.values(state.toolResults || {});
    let schemaHint = '[]';
    let jsonlData = '';

    if (results.length > 0) {
        const prepped = prepareMongoForLLM(results);
        schemaHint = prepped.schemaHint;
        jsonlData = prepped.jsonlData;
    }

    let systemPrompt = `You are a professional maritime operations analyst with access to system dataset results. Your goal is to provide accurate, data-driven insights.
Do not hallucinate keys. Stick tightly to the response provided. Your tone should be efficient, technically accurate, and helpful. Verify units (Currency, Timezones) when available.

### GLOBAL SCHEMA CONTEXT
${schemaHint}

### INPUT DATA
- Data (JSONL):
${jsonlData}
`;

    if (results.length === 0) {
        systemPrompt = `You are a professional maritime operations assistant. 
The orchestrator has decided to ask the user a clarifying question or provide a direct response instead of calling tools. 
Please formulate a polite, efficient response back to the user based on the conversation history and any pending question.`;
    }

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
        ...state.messages 
    ];

    console.log(`[LangGraph Summarizer] --- PROMPT SENT TO LLM ---`);
    console.log(JSON.stringify(promptMessages, null, 2));

    try {
        const response = await model.invoke(promptMessages);

        console.log(`[LangGraph Summarizer Output]`, response.content);

        return { 
            // In a StateGraph structure, returning a message appends it if reducer is set to concat!
            messages: [{ role: "assistant", content: response.content ? String(response.content) : "" } as any] 
        };
    } catch (e: any) {
        console.error(`[LangGraph] Failed to generate summary`, e);
        return { error: `Summarizer Node failed: ${e.message || String(e)}` };
    }
}
