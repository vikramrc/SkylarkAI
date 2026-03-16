import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';
import { buildCapabilityDescription, buildCapabilityInputSchema } from './contract.js';

dotenv.config();

/**
 * Fetches the MCP capability contract from PhoenixCloudBE
 * and maps it to the standard format required by @modelcontextprotocol/sdk.
 */
export async function syncCapabilities(orgId?: string) {
    const backendUrl = process.env.PHOENIX_CLOUD_URL || 'https://localhost:3000';
    
    // Use passed orgId or fallback to environment (no hardcoded fallback)
    const currentOrgId = orgId || process.env.PHOENIX_CLOUD_ORGANIZATION_ID;
    
    try {
        const params: any = {};
        if (currentOrgId) {
            params.organizationID = currentOrgId;
        }

        // Warning: Localhost with self-signed certs might fail in Node.js, we should allow unauthorized if needed.
        const response = await axios.get(`${backendUrl}/api/mcp/capabilities`, {
            params,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        
        const contract = response.data.capabilities;
        if (!contract || !Array.isArray(contract)) {
            console.warn("Capabilities payload missing or malformed.");
            return [];
        }

        // Map to MCP standard tools
        const tools = contract.map((cap: any) => {
            return {
                name: cap.name,
                description: buildCapabilityDescription(cap),
                inputSchema: buildCapabilityInputSchema(cap),
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
