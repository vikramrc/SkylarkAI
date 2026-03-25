import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { SkylarkState } from "../state.js";
import { prepareMongoForLLM } from "../../phoenixai/runtime/executor.js";
import fs from "fs"; // 🟢 Import for contract schemas
import { activeStreams } from "../utils/stream_manager.js"; // 🟢 Import active streams for cancellation

// 🟢 Pre-load Capabilities Contract once at startup to optimize node performance
const CONTRACT_PATH = process.env.PHOENIX_CONTRACT_PATH || '/home/phantom/testcodes/PhoenixCloudBE/constants/mcp.capabilities.contract.js';
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
    const toolEntries = Object.entries(state.toolResults || {});
    let schemaHint = '[]';
    let jsonlData = '';
    const allItems: any[] = [];
    const emptyTools: string[] = [];
    let toolCountSummary = "";

    if (toolEntries.length > 0) {
        // 🟢 Unpack MCP Wrapper accurately
        const unpackedEntries = toolEntries.map(([key, res]: [string, any]) => {
            let data = res;
            if (data?.content?.[0]?.text) {
                try {
                    const parsed = JSON.parse(data.content[0].text);
                    if (parsed) data = parsed;
                } catch (e) {
                    console.warn(`[Summarizer] Failed to parse content[0].text JSON`, e);
                }
            }
            return { key, data };
        });

        // 🔴 CRITICAL FIX: extract the actual *items* arrays from each tool result wrapper
        const toolCountMap: string[] = [];
        for (const entry of unpackedEntries) {
            const { key, data: result } = entry;
            const capability = result?.capability ?? 'unknown';
            const items = Array.isArray(result?.items) ? result.items : [result];
            
            const filterInfo = result?.appliedFilters?.statusCode ? ` (filter: ${result.appliedFilters.statusCode})` : '';
            toolCountMap.push(`- **${key}** (${capability}${filterInfo}): ${items.length} rows`);

            if (Array.isArray(result?.items) && result.items.length === 0) {
                emptyTools.push(`- **${key}** (${capability}): Returned 0 matching items.`);
            }
            // Tag each row with its source tool KEY so the LLM can distinguish multi-tool responses
            for (const item of items) {
                // 🟢 SANITIZE DATA: Trim and cap strings to prevent "index blindness" from junk data/whitespace
                const sanitizedItem = { ...item };
                for (const [k, v] of Object.entries(sanitizedItem)) {
                    if (typeof v === 'string') {
                        // Collapse massive whitespace gaps to prevent LLM counting errors, but preserve the FULL string data.
                        sanitizedItem[k] = v.replace(/\s+/g, ' ').trim();
                    }
                }
                allItems.push({ _tool: key, ...sanitizedItem });
            }
        }

        toolCountSummary = toolCountMap.join('\n');

        console.log(`\x1b[36m${ts()} [LangGraph Summarizer] 📐 Flattening ${allItems.length} total rows across ${unpackedEntries.length} tool result(s)\x1b[0m`);
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
        const firstRow = parsedPayload.rows[0];
        if (firstRow) {
            console.log(`  ➡ Row[0] sample:     ${JSON.stringify(firstRow.slice(0, 10))}${firstRow.length > 10 ? ` ...` : ''}`);
        }

        // 🟢 Inject Static Contract Shape for ALL unique capabilities
        const injectedCapabilities = new Set<string>();
        for (const entry of unpackedEntries) {
            const capabilityName = entry.data?.capability;
            if (capabilityName && contractStrCache && !injectedCapabilities.has(capabilityName)) {
                injectedCapabilities.add(capabilityName);
                try {
                    const blockRegex = new RegExp(`name:\\s*"${capabilityName}"[\\s\\S]*?responseShape:\\s*(\\[[\\s\\S]*?\\])`);
                    const match = contractStrCache.match(blockRegex);
                    if (match && match[1]) {
                        const staticShape = match[1].replace(/\\s+/g, ' ');
                        schemaHint = `Contract Keys (${capabilityName}): ${staticShape}\n` + schemaHint;
                        console.log(`\x1b[36m${ts()} [LangGraph Summarizer] 📄 Injected contract shape for capability: ${capabilityName}\x1b[0m`);
                    }
                } catch (e) {
                    console.warn(`[Summarizer] Failed to read static contract shape for ${capabilityName}`, e);
                }
            }
        }
    }

    let systemPrompt = `You are a professional maritime operations analyst with access to system dataset results. Your goal is to provide accurate, data-driven insights.
Do not hallucinate keys. Stick tightly to the response provided. Your tone should be efficient, technically accurate, and helpful. Verify units (Currency, Timezones) when available.

- **Completion Directive (Critical)**: Your role is purely **Analytical**. DO NOT replicate or list out row-level dataset items (e.g., full item rows, exact IDs) in your response text. The raw items are already being rendered into a grid visual for the user. Summarize the **findings**, explain the **trends/issues**, and answer the core question asked. Keep descriptions concise and focused on high-level synthesis or actionable insights.

- **Data Presentation (Critical)**: Avoid replicating datasets into markdown tables. The raw items are already displayed in the UI grid. Use standard text or bullet points to explain high-level metrics or comparative summaries ONLY if strictly beneficial.

- **Analytical Formatting (Premium UI)**: When results come from multiple tools or have distinct themes (e.g., Overdue vs Upcoming), you MUST wrap each logical section in '[INSIGHT title="..." icon="..." color="..."]...[/INSIGHT]' tags.
  - **title**: A short, punchy header (matching or derived from the tool's uiTabLabel).
  - **icon**: Pick exactly one from: 'alert' (for overdue/critical), 'calendar' (for upcoming/planned), 'check' (for completed/committed), or 'lightbulb' (for general trends).
  - **color**: Pick exactly one from: 'red' (danger), 'amber' (warning), 'green' (success), or 'blue' (info/general).
  - **Content**: Inside the tags, use concise bullet points and **bolding** for key values. If you identify any deeper correlations, overarching trends, or critical takeaways across the datasets, you MUST explicitly list them in a final high-level '[INSIGHT title="Core Takeaway" icon="lightbulb" color="blue"]' block. Finding these cross-dataset insights is your primary purpose.

### GLOBAL SCHEMA CONTEXT
${schemaHint}
`;

    const noToolsCalled = !state.toolCalls || state.toolCalls.length === 0;
    // 🔴 CRITICAL FALLBACK: If tools were called but returned 0 items overall, treat it as empty conversational mode
    const emptyDataset = toolEntries.length > 0 && typeof allItems !== 'undefined' && allItems.length === 0;

    if (noToolsCalled || emptyDataset) {
        systemPrompt = `You are a professional maritime operations assistant. 
The system dataset is currently **EMPTY** (tools returned 0 matching records). 
Please formulate a polite, helpful response back to the user based on the conversation history and any active filters in memory context.
Be explicit that the query returned no items, but use your general context to explain why (e.g., filter mismatch) or offer next steps.`;
    }

    const promptMessages = [
        { role: "system", content: systemPrompt } as any,
    ];

    if (state.workingMemory?.summaryBuffer) {
        promptMessages.push({
            role: "system",
            content: `\n### OBSERVATIONAL STATUS CONTEXT (FROM PREVIOUS TURN)\nUse this to understand active filters/focus:\n${state.workingMemory.summaryBuffer}\n\n⚠️ IMPORTANT: This memory summary is from the PREVIOUS loop. If the active filters or scope changed, the raw INPUT DATA array (provided below) always overrides this memory. Do NOT trust this memory for exact row counts or statuses if they contradict the raw INPUT DATA array you are receiving now!`
        } as any);
    }

    if ((noToolsCalled || emptyDataset) && state.messages && state.messages.length > 0) {
        // Only push the last message from user to keep dialogue crisp when acting in purely conversational mode
        promptMessages.push(state.messages[state.messages.length - 1]);
    } else {
        promptMessages.push(...state.messages);
    }

    const emptyToolsSection = emptyTools.length > 0 
        ? `\n\n### ⚠️ EMPTY TOOL RESULTS\nThe following tools returned 0 matching records or empty item arrays:\n${emptyTools.join('\n')}` 
        : "";

    promptMessages.push(
        { 
            role: "user", 
            content: `### INPUT DATA (Compact Array Format)\nThe dataset is serialized in a token-efficient compact format. 
\n### TOOL RESULTS MAP (EXPECTED COUNTS)
Use this map to verify you haven't missed any data rows:
${toolCountSummary}

- "headers": ordered column names for each data field
- "rows": each row is a value array aligned to the headers (null = missing field)
Arrays and nested objects are JSON-stringified inline within the cell value.

⚠️ **Strict Index Offset Anchor**: When reading values, always match \`row[i]\` strictly to \`headers[i]\`. Do not assume item positions across rows of irregular lengths. Booleans like \`isOverdue\` and \`isUpcoming\` are typically near the end of the row.${emptyToolsSection}\n\n${jsonlData}` 
        } as any
    );

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
