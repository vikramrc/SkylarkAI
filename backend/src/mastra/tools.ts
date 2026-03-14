import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { serviceBackedPhoenixRuntimeEngine } from '../phoenixai/index.js';
import { capabilitiesContract, buildCapabilityDescription, getParameterDescription } from '../mcp/capabilities/contract.js';
import { proxyToolCall } from '../mcp/proxy.js';
import { ambiguityStore, setAmbiguity } from './ambiguity-store.js';

export const directQueryFallback = createTool({
  id: 'direct_query_fallback',
  description: 'Use this tool for general maritime queries, complex data aggregation, or when no other specific maintenance/procurement tool covers the request. This tool performs a direct semantic search and MongoQL query against the database.',
  inputSchema: z.object({
    userQuery: z.string().describe('The user\'s original query or a refined version for database searching.'),
  }),
  execute: async (input, context) => {
    const userQuery = input?.userQuery || '';
    console.log(`[Mastra Fallback] Calling Direct Query Engine (Streaming)...`);
    const startTime = Date.now();
    let finalData = null;
    
    try {
        if (!serviceBackedPhoenixRuntimeEngine.processUserQueryStream) {
            throw new Error('Direct query engine does not support streaming');
        }

        const resultPromise = serviceBackedPhoenixRuntimeEngine.processUserQueryStream({
            userQuery: userQuery,
            onEvent: async (event: any) => {
                const { event: eventName, data } = event;
                const d = data as any;
                
                switch (eventName) {
                    case 'status':
                        console.log(`[DirectQuery Status] ${d.stage}: ${d.message}`);
                        break;
                    case 'llm':
                        if (d.kind === 'start') {
                            console.log(`[DirectQuery LLM] Start: ${d.purpose} (${d.model})`);
                        } else if (d.kind === 'delta' && d.delta) {
                            process.stdout.write(d.delta);
                        } else if (d.kind === 'complete') {
                            process.stdout.write('\n');
                            console.log(`[DirectQuery LLM] Complete`);
                        }
                        break;
                    case 'result':
                        finalData = d;
                        try {
                            const preview = d?.results ? (d.results.length === 0 ? '[]' : JSON.stringify(d.results).slice(0, 251)) : 'No results field';
                            console.log(`[DirectQuery Result] Received Final Data: ${preview}`);
                        } catch (logError) {
                            console.log(`[DirectQuery Result] Received Final Data (Preview failed)`);
                        }
                        break;
                    case 'error':
                        console.error(`[DirectQuery Error] ${d.message || JSON.stringify(d)}`);
                        break;
                }
            }
        });

        const result = await resultPromise;
        const isAmbiguous = (result as any)?.status === 'ambiguous' || (result as any)?.is_ambiguous === true;
        
        if (isAmbiguous) {
            console.log(`[Mastra Fallback] Ambiguity detected. Returning sentinel to workflow.`);
            // Write to shared store so the workflow can intercept BEFORE the summarizer.
            const getRunId = (ctx: any) => {
                if (!ctx) return null;
                // Check RequestContext first (passed from workflow)
                // Note: Mastra tools usually pass this in context.requestContext
                const rc = ctx.requestContext;
                if (rc && typeof rc.get === 'function') {
                    const ctxRunId = rc.get('runId');
                    if (ctxRunId) return ctxRunId;
                }
                
                // Fallback to direct get if context itself is the RequestContext
                if (typeof ctx.get === 'function') {
                    const ctxRunId = ctx.get('runId');
                    if (ctxRunId) return ctxRunId;
                }

                // Fallback to AI SDK internal IDs
                if (ctx.runId) return ctx.runId;
                if (ctx.threadId) return ctx.threadId;
                return null;
            };
            const threadId = getRunId(context);
            if (threadId) {
                setAmbiguity(threadId, result);
                console.log(`[Mastra Fallback] Ambiguity stored for thread: ${threadId}`);
            } else {
                console.warn(`[Mastra Fallback] WARNING: No threadId/runId found in context. Cannot write to Ambiguity Store.`);
                console.log(`[Mastra Fallback] Context keys available:`, context ? Object.keys(context) : 'null');
                if (context?.requestContext) {
                    console.log(`[Mastra Fallback] RequestContext keys available:`, Object.keys(context.requestContext));
                }
            }
            // Also return a sentinel value — do NOT throw. Throwing wraps the error in
            // MastraError which makes the JSON impossible to reliably scan in the workflow.
            return {
                success: false,
                source: 'direct_query_layer',
                __ambiguity_stop: true,
                data: result,
            };
        }

        console.log(`[Mastra Fallback] Direct Query Engine finished in ${Date.now() - startTime}ms`);

        return {
            success: true,
            source: 'direct_query_layer',
            data: finalData || result,
        };
    } catch (error: any) {
        console.error(`[Mastra Fallback] Direct Query Engine failed after ${Date.now() - startTime}ms:`, error.message);
        throw error;
    }
  },
});

function sanitizeToolName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const mcpTools = capabilitiesContract.reduce((acc, cap) => {
    const toolId = sanitizeToolName(cap.name);
    
    // Build Zod schema from contract query fields
    const schemaProps: Record<string, any> = {};
    const allFields = [...(cap.requiredQuery || []), ...(cap.optionalQuery || [])];
    
    allFields.forEach(field => {
        const description = getParameterDescription(field, cap.requiredQuery || []);
        let fieldSchema = z.string().describe(description);
        
        // Strictly enforce ObjectId format for ID fields (except organizationID/vesselID which have friendly fallbacks)
        if (field.endsWith('ID') && field !== 'organizationID' && field !== 'vesselID') {
            fieldSchema = fieldSchema.regex(/^[0-9a-fA-F]{24}$/, {
                message: `${field} must be a valid 24-character hex Mongo ObjectId. Use a lookup tool to find the ID if you only have a name.`
            });
        }

        schemaProps[field] = cap.requiredQuery?.includes(field) ? fieldSchema : fieldSchema.optional();
    });

    acc[toolId] = createTool({
        id: toolId,
        description: buildCapabilityDescription(cap),
        inputSchema: z.object(schemaProps),
        execute: async (input, context) => {
            const token = context?.requestContext?.get('token') || (context as any)?.token || '';
            
            // Auto-fill organization identifiers if missing but known in working memory
            const updatedInput = { ...input };
            
            // Map context variables if they exist
            const contextOrg = (context as any)?.workingMemory?.userPreferences?.orgShortName;
            const contextVessel = (context as any)?.workingMemory?.userPreferences?.currentFocusedVessel;

            if (!updatedInput.organizationShortName && !updatedInput.organizationID && contextOrg) {
                updatedInput.organizationShortName = contextOrg;
            }
            if (!updatedInput.vesselName && !updatedInput.vesselID && contextVessel) {
                updatedInput.vesselName = contextVessel;
            }

            console.log(`[Agent Tool] Calling ${toolId} with:`, JSON.stringify(updatedInput, null, 2));

            const result = await proxyToolCall(
                {
                    ...cap,
                    name: toolId,
                    _originalPath: cap.path,
                    _originalMethod: cap.method,
                },
                updatedInput,
                token
            );
            return result;
        }
    });

    return acc;
}, {} as Record<string, any>);

export const skylarkTools = {
  direct_query_fallback: directQueryFallback,
  ...mcpTools,
};
