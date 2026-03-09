import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { capabilitiesContract } from "./capabilities/contract.js";
import { proxyToolCall } from "./proxy.js";

// We keep a mapping of active transports to their respective tokens
const sessions = new Map();

// Generate the tool schemas from the constant file once on server boot
const registeredTools = capabilitiesContract.map(cap => {
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
        _originalPath: cap.path,
        _originalMethod: cap.method
    };
});

export async function setupMcpRoutes(app: express.Express) {
    let globalSessionId = 0;

    app.get("/mcp/sse", async (req: express.Request, res: express.Response) => {
        // Extract token from Auth header or Query string (since EventSource API doesn't allow custom headers from browser naturally)
        let token = req.headers.authorization;
        if (!token && req.query.token) {
            token = `Bearer ${req.query.token}`;
        }
        
        if (!token) {
            console.warn("Connection attempt without a token. Continuing, but requests will fail at the proxy.");
        }

        const sessionId = ++globalSessionId;
        const transport = new SSEServerTransport("/mcp/messages?sessionId=" + sessionId, res);
        
        const server = new Server({
            name: `skylarkai-mcp-${sessionId}`,
            version: "1.0.0",
        }, {
            capabilities: { tools: {} }
        });

        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: registeredTools.map(t => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema
                }))
            };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const toolDef = registeredTools.find(t => t.name === name);
            if (!toolDef) throw new Error(`Tool not found: ${name}`);
            
            // Pass the specific connection's token
            return await proxyToolCall(toolDef, (args as Record<string, any>) || {}, token || "");
        });

        await server.connect(transport);
        sessions.set(sessionId.toString(), { server, transport, token });
        
        res.on('close', () => {
            sessions.delete(sessionId.toString());
        });
    });

    app.post("/mcp/messages", async (req: express.Request, res: express.Response) => {
        const sessionId = req.query.sessionId;
        const session = sessions.get(sessionId);
        if (!session) {
            return res.status(404).send("Session not found or expired");
        }
        await session.transport.handlePostMessage(req, res);
    });
}
