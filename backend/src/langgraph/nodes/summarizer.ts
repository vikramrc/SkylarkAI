import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { SkylarkState } from "../state.js";
import { prepareMongoForLLM } from "../../phoenixai/runtime/executor.js";
import fs from "fs"; // 🟢 Import for contract schemas
import { activeStreams } from "../utils/stream_manager.js"; // 🟢 Import active streams for cancellation

// 🟢 Pre-load Capabilities Contract once at startup to optimize node performance
const CONTRACT_PATH = '/home/phantom/testcodes/PhoenixCloudBE/constants/mcp.capabilities.contract.js';
let contractStrCache = "";

try {
    if (fs.existsSync(CONTRACT_PATH)) {
        contractStrCache = fs.readFileSync(CONTRACT_PATH, 'utf-8');
        console.log(`\x1b[36m[Startup] 📄 Preloaded capabilities contract into memory cache\x1b[0m`);
    } else {
        console.warn(`\x1b[33m[Startup] ⚠️ Contract path not found: ${CONTRACT_PATH}\x1b[0m`);
    }
} catch (e: any) {
    console.error(`[Summarizer] Failed to preload capabilities contract`, e.message || e);
}


/**
 * nodeSummarizer aggregates the toolResults into a final user-facing pretty report.
 */
export async function nodeSummarizer(state: SkylarkState, config?: any): Promise<Partial<SkylarkState>> {
    const ts = () => `[${new Date().toISOString().substring(11, 19)}]`;
    console.log(`\x1b[36m${ts()} [LangGraph] 📝 Summarizer Node invoked\x1b[0m`);
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
        // 🟢 Unpack MCP Wrapper accurately
        const unpackedResults = results.map((res: any) => {
            let data = res;
            if (data?.content?.[0]?.text) {
                try {
                    const parsed = JSON.parse(data.content[0].text);
                    if (parsed) data = parsed;
                } catch (e) {
                    console.warn(`[Summarizer] Failed to parse content[0].text JSON`, e);
                }
            }
            return data;
        });

        // 🔴 CRITICAL FIX: extract the actual *items* arrays from each tool result wrapper
        // Before this fix, prepareMongoForLLM received [{capability, items:[...], summary:{}}]
        // which flattened the outer wrapper shape instead of the actual 100 data rows.
        // Now we extract items[] from each result (falling back to the whole object if no items key).
        const allItems: any[] = [];
        for (const result of unpackedResults) {
            const capability = result?.capability ?? 'unknown';
            const items = Array.isArray(result?.items) ? result.items : [result];
            // Tag each row with its source tool so the LLM can distinguish multi-tool responses
            for (const item of items) {
                allItems.push({ _tool: capability, ...item });
            }
        }

        console.log(`\x1b[36m${ts()} [LangGraph Summarizer] 📐 Flattening ${allItems.length} total rows across ${unpackedResults.length} tool result(s)\x1b[0m`);
        const beforeSize = JSON.stringify(allItems).length;

        const prepped = prepareMongoForLLM(allItems);
        schemaHint = prepped.schemaHint;
        jsonlData = prepped.jsonlData;

        const afterSize = jsonlData.length;
        const savingsPct = beforeSize > 0 ? (((beforeSize - afterSize) / beforeSize) * 100).toFixed(1) : '0';
        const parsedPayload = JSON.parse(jsonlData) as { headers: string[], rows: any[][] };

        console.log(`\x1b[36m${ts()} [LangGraph Summarizer] 📊 Payload Compression Report:\x1b[0m`);
        console.log(`  ➡ Raw items size:    ${beforeSize} chars`);
        console.log(`  ➡ Flattened size:    ${afterSize} chars  (${savingsPct}% reduction)`);
        console.log(`  ➡ Header columns:    ${parsedPayload.headers.length}`);
        console.log(`  ➡ Row count:         ${parsedPayload.rows.length}`);
        console.log(`  ➡ Headers preview:   ${JSON.stringify(parsedPayload.headers.slice(0, 20))}${parsedPayload.headers.length > 20 ? ` ... (+${parsedPayload.headers.length - 20} more)` : ''}`);
        // Log first row sample so we can visually verify alignment
        if (parsedPayload.rows.length > 0) {
            console.log(`  ➡ Row[0] sample:     ${JSON.stringify((parsedPayload.rows[0] ?? []).slice(0, 10))}...`);
        }

        // 🟢 Inject Static Contract Shape
        const firstItem = unpackedResults[0];
        const capabilityName = firstItem?.capability;
        if (capabilityName && contractStrCache) {
            try {
                const blockRegex = new RegExp(`name:\\s*"${capabilityName}"[\\s\\S]*?responseShape:\\s*(\\[[\\s\\S]*?\\])`);
                const match = contractStrCache.match(blockRegex);
                if (match && match[1]) {
                    const staticShape = match[1].replace(/\s+/g, ' ');
                    schemaHint = `Contract Keys: ${staticShape}\nUnique Keys: ${schemaHint}`;
                    console.log(`\x1b[36m${ts()} [LangGraph Summarizer] 📄 Injected contract shape for capability: ${capabilityName}\x1b[0m`);
                }
            } catch (e) {
                console.warn(`[Summarizer] Failed to read static contract shape for ${capabilityName}`, e);
            }
        }
    }

    let systemPrompt = `You are a professional maritime operations analyst with access to system dataset results. Your goal is to provide accurate, data-driven insights.
Do not hallucinate keys. Stick tightly to the response provided. Your tone should be efficient, technically accurate, and helpful. Verify units (Currency, Timezones) when available.

- **Completion Directive (Critical)**: Your role is purely **Analytical**. DO NOT replicate or list out row-level dataset items (e.g., full item rows, exact IDs) in your response text. The raw items are already being rendered into a grid visual for the user. Summarize the **findings**, explain the **trends/issues**, and answer the core question asked. Keep descriptions concise and focused on high-level synthesis or actionable insights.

- **Data Presentation (Critical)**: Avoid replicating datasets into markdown tables. The raw items are already displayed in the UI grid. Use standard text or bullet points to explain high-level metrics or comparative summaries ONLY if strictly beneficial.

### GLOBAL SCHEMA CONTEXT
${schemaHint}
`;

    if (results.length === 0) {
        systemPrompt = `You are a professional maritime operations assistant. 
The orchestrator has decided to ask the user a clarifying question or provide a direct response instead of calling tools. 
Please formulate a polite, efficient response back to the user based on the conversation history and any pending question.`;
    }

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
        ...state.messages,
        { role: "user", content: `### INPUT DATA (Compact Array Format)\nThe dataset is serialized in a token-efficient compact format to reduce latency:\n- "headers": ordered column names for each data field\n- "rows": each row is a value array aligned to the headers (null = missing field)\nArrays and nested objects are JSON-stringified inline within the cell value.\n\n${jsonlData}` } as any
    ];

    console.log(`\x1b[36m${ts()} [LangGraph Summarizer] --- PROMPT SENT TO LLM ---\x1b[0m`);
    console.log(JSON.stringify(promptMessages, null, 2));

    try {
        const threadId = config?.configurable?.thread_id;
        const abortCtrl = threadId ? activeStreams.get(threadId) : null;
        
        // 🟢 Using model.stream() explicitly flawlessly trigger
        const responseStream = await model.stream(promptMessages, { signal: abortCtrl?.signal });
        let fullContent = "";

        for await (const chunk of responseStream) {
            fullContent += chunk.content || "";
        }

        // 🟢 Log Token Caching Savings
        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("Summarizer", { content: fullContent }); // mock structure for logger flawlessly

        console.log(`[LangGraph Summarizer Output]`, fullContent);

        return { 
            messages: [{ role: "assistant", content: fullContent } as any] 
        };
    } catch (e: any) {
        console.error(`[LangGraph] Failed to generate summary`, e);
        return { error: `Summarizer Node failed: ${e.message || String(e)}` };
    }
}
