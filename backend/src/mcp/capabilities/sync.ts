import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

/**
 * Fetches the MCP capability contract from PhoenixCloudBE
 * and maps it to the standard format required by @modelcontextprotocol/sdk.
 */
export async function syncCapabilities() {
    const backendUrl = process.env.PHOENIX_CLOUD_BE_URL || 'https://localhost:3000';
    // We send a dummy string or standard org ID to get the capabilities.
    // The capabilities endpoint might require an org ID. Let's use Halcyon's org ID from earlier or just a dummy one.
    const orgId = process.env.PHOENIX_CLOUD_ORGANIZATION_ID || '67eedd60c1ceddb21d80ad45';
    
    try {
        // Warning: Localhost with self-signed certs might fail in Node.js, we should allow unauthorized if needed.
        const response = await axios.get(`${backendUrl}/api/mcp/capabilities`, {
            params: { organizationID: orgId },
            headers: {
                Authorization: `Bearer ${process.env.PHOENIX_CLOUD_PROXY_TOKEN}`
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        
        const contract = response.data.capabilities;
        if (!contract || !Array.isArray(contract)) {
            console.warn("Capabilities payload missing or malformed.");
            return [];
        }

        // Map to MCP standard tools
        const tools = contract.map((cap: any) => {
            const properties: Record<string, any> = {};
            const required = cap.requiredQuery || [];
            
            [...(cap.requiredQuery || []), ...(cap.optionalQuery || [])].forEach(param => {
                properties[param] = { type: "string", description: `Parameter: ${param}` };
            });

            return {
                name: cap.name,
                description: cap.purpose + (cap.whenToUse ? ` When to use: ${cap.whenToUse}` : ''),
                inputSchema: {
                    type: "object",
                    properties,
                    required
                },
                // Keep the original path for the proxy to use
                _originalPath: cap.path,
                _originalMethod: cap.method
            };
        });
        
        return tools;
    } catch (error: any) {
        console.error("Failed to sync capabilities from PhoenixCloudBE:", error.message);
        return [];
    }
}
