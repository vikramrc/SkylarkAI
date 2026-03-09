import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

/**
 * Proxies the tool call arguments to PhoenixCloudBE and returns the result.
 * It is 100% agnostic. Needs token passed, or it takes the one attached to the session.
 */
export async function proxyToolCall(toolDef: any, args: Record<string, any>, token: string) {
    const backendUrl = process.env.PHOENIX_CLOUD_BE_URL || 'https://localhost:3000';
    
    // Safety check strictly to inform the LLM/User if they forgot argument
    if (!args.organizationID) {
        return {
            content: [{ type: "text", text: "Error: organizationID is a required argument for this tool." }],
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
            content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }]
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
