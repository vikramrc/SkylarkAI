import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

function hasProvidedValue(value: any) {
    return !(value === undefined || value === null || (typeof value === 'string' && value.trim() === ''));
}

/**
 * Proxies the tool call arguments to PhoenixCloudBE and returns the result.
 * It is 100% agnostic. Needs token passed, or it takes the one attached to the session.
 */
export async function proxyToolCall(toolDef: any, args: Record<string, any>, token: string) {
    const backendUrl = process.env.PHOENIX_CLOUD_BE_URL || 'https://localhost:3000';
    
    // Safety check strictly to inform the LLM/User if they forgot required arguments.
    // Do not hardcode organizationID here because the contract may legitimately allow
    // organizationShortName or organizationName instead.
    const requiredFields = Array.isArray(toolDef?.inputSchema?.required) ? toolDef.inputSchema.required : [];
    const missingRequired = requiredFields.filter((field: string) => !hasProvidedValue(args?.[field]));
    if (missingRequired.length > 0) {
        return {
            content: [{ type: "text", text: `Error: missing required arguments: ${missingRequired.join(', ')}` }],
            isError: true
        };
    }
    
    if (!token) {
        return {
            content: [{ type: "text", text: "Error: No authentication token was provided by the MCP Client connection." }],
            isError: true
        };
    }

    try {
        const response = await axios({
            method: toolDef._originalMethod || 'GET',
            url: `${backendUrl}${toolDef._originalPath}`,
            params: args,
            headers: {
                Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        
        return {
            content: [{ type: "text", text: JSON.stringify(response.data) }]
        };
    } catch (error: any) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Proxy error for ${toolDef.name}:`, errorMsg);
        return {
            content: [{ type: "text", text: `Error: ${errorMsg}` }],
            isError: true
        };
    }
}
