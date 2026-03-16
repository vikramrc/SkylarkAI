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
    const backendUrl = process.env.PHOENIX_CLOUD_URL || 'https://localhost:3000';
    
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
    
    try {
        const headers: Record<string, string> = {};

    if (token) {
        const isCookieString = token.includes(';') || token.includes('=');
        if (isCookieString) {
            headers['Cookie'] = token;
        } else {
            headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
            
            // Extract organizationID from token if available and not already provided
            try {
                const tokenString = token.startsWith('Bearer ') ? token.split(' ')[1] : token;
                if (tokenString) {
                    const tokenParts = tokenString.split('.');
                    if (tokenParts.length === 3) {
                        const payloadPart = tokenParts[1];
                        if (payloadPart) {
                            const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
                            if (payload.iss && !args.organizationID && !args.organizationShortName && !args.organizationName) {
                                args.organizationID = payload.iss;
                                console.log(`[Proxy] Automatically injected organizationID from token: ${payload.iss}`);
                            }
                        }
                    }
                }
            } catch (e) {
                // Safe to ignore if not a valid JWT or parse fails
            }
        }
    }

        const response = await axios({
            method: toolDef._originalMethod || 'GET',
            url: `${backendUrl}${toolDef._originalPath}`,
            params: args,
            headers,
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
