import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { serviceBackedPhoenixRuntimeEngine } from '../phoenixai/index.js';
import { capabilitiesContract, buildCapabilityDescription } from '../mcp/capabilities/contract.js';
import { proxyToolCall } from '../mcp/proxy.js';

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
                        console.log(`[DirectQuery Result] Received Final Data`);
                        break;
                    case 'error':
                        console.error(`[DirectQuery Error] ${d.message || JSON.stringify(d)}`);
                        break;
                }
            }
        });

        const result = await resultPromise;
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
    
    acc[toolId] = createTool({
        id: toolId,
        description: buildCapabilityDescription(cap),
        inputSchema: z.object(
            cap.inputSchema?.properties ? Object.keys(cap.inputSchema.properties).reduce((props, key) => {
                const prop = cap.inputSchema.properties[key];
                let schema = z.any();
                if (prop.description) {
                   schema = schema.describe(prop.description);
                }
                props[key] = cap.inputSchema.required?.includes(key) ? schema : schema.optional();
                return props;
            }, {} as Record<string, any>) : {}
        ),
        execute: async (input, context) => {
            const token = context?.requestContext?.get('token') || (context as any)?.token || '';
            
            // Auto-fill organization identifiers if missing but known in working memory
            // This prevents "organizationShortName is required" errors when the agent 
            // forgets to map it from history to the tool call.
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
