import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "crypto";
import { buildCapabilityDescription, buildCapabilityInputSchema, capabilitiesContract } from "./capabilities/contract.js";
import { proxyToolCall } from "./proxy.js";

function sanitizeToolName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Registered tools built once on server boot from the contract
const registeredTools = capabilitiesContract.map(cap => {
    return {
        name: sanitizeToolName(cap.name),
        originalName: cap.name,
        description: buildCapabilityDescription(cap),
        inputSchema: buildCapabilityInputSchema(cap),
        _originalPath: cap.path,
        _originalMethod: cap.method
    };
});

const toolsByName = new Map(registeredTools.map(tool => [tool.name, tool]));
const duplicateToolNames = registeredTools
    .map(tool => tool.name)
    .filter((name, index, allNames) => allNames.indexOf(name) !== index);

if (duplicateToolNames.length > 0) {
    throw new Error(`Duplicate sanitized MCP tool names detected: ${duplicateToolNames.join(", ")}`);
}

console.log(`[MCP] Loaded ${registeredTools.length} tools from contract.`);

// Helper: Create a new MCP Server instance with handlers
function createMcpServer(token: string) {
    const server = new Server({
        name: "skylarkai-mcp",
        version: "1.0.0",
    }, {
        capabilities: { tools: {} }
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: registeredTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }))
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const toolDef = toolsByName.get(name);
        if (!toolDef) throw new Error(`Tool not found: ${name}`);
        console.log(`[MCP] Tool call: ${name} -> ${toolDef.originalName} | args: ${JSON.stringify(args)}`);
        return await proxyToolCall(toolDef, (args as Record<string, any>) || {}, token || "");
    });

    return server;
}

// Session store for Streamable HTTP
const streamableSessions = new Map<string, StreamableHTTPServerTransport>();

// Session store for legacy SSE
const sseSessions = new Map<string, { server: Server; transport: SSEServerTransport; token: string | undefined }>();

function getConnectionToken(req: express.Request) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.length > 0) {
        return authHeader;
    }

    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    return queryToken ? `Bearer ${queryToken}` : "";
}

function sendJsonRpcError(res: express.Response, status: number, code: number, message: string) {
    return res.status(status).json({
        jsonrpc: "2.0",
        error: { code, message },
        id: null
    });
}

async function handleStreamableHttpRequest(req: express.Request, res: express.Response) {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;

    if (sessionId) {
        const existingTransport = streamableSessions.get(sessionId);
        if (!existingTransport) {
            return sendJsonRpcError(res, 404, -32001, "Session not found");
        }

        await existingTransport.handleRequest(req, res, req.body);
        return;
    }

    if (req.method !== "POST" || !isInitializeRequest(req.body)) {
        return sendJsonRpcError(res, 400, -32000, "Must send initialize request first");
    }

    const token = getConnectionToken(req);
    let server!: Server;

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
            streamableSessions.set(newSessionId, transport);
            console.log(`[MCP] Streamable session started: ${newSessionId}`);
        },
        onsessionclosed: (closedSessionId) => {
            if (streamableSessions.delete(closedSessionId)) {
                console.log(`[MCP] Streamable session terminated: ${closedSessionId}`);
            }
        }
    });

    transport.onclose = () => {
        const activeSessionId = transport.sessionId;
        if (activeSessionId && streamableSessions.delete(activeSessionId)) {
            console.log(`[MCP] Streamable session closed: ${activeSessionId}`);
        }
    };

    transport.onerror = (error) => {
        console.error("[MCP] Streamable transport error:", error);
    };

    server = createMcpServer(token);
    await server.connect(transport as any);
    await transport.handleRequest(req, res, req.body);
}

export async function setupMcpRoutes(app: express.Express) {

    // ─────────────────────────────────────────────────────────────────
    // MODERN: Streamable HTTP Transport (standard MCP Inspector endpoint)
    // ─────────────────────────────────────────────────────────────────
    app.all("/mcp", async (req: express.Request, res: express.Response) => {
        console.log(`[MCP] Streamable HTTP ${req.method} /mcp`);

        if (req.method === "HEAD") {
            res.status(204).end();
            return;
        }

        await handleStreamableHttpRequest(req, res);
    });

    // Compatibility alias for clients still pointed at /mcp/sse.
    app.post("/mcp/sse", async (req: express.Request, res: express.Response) => {
        console.log(`[MCP] Streamable HTTP POST /mcp/sse`);
        await handleStreamableHttpRequest(req, res);
    });

    app.delete("/mcp/sse", async (req: express.Request, res: express.Response) => {
        console.log(`[MCP] Streamable HTTP DELETE /mcp/sse`);
        await handleStreamableHttpRequest(req, res);
    });

    // GET /mcp/sse stays as legacy SSE unless the caller is resuming a
    // streamable-http session with the standard Mcp-Session-Id header.
    app.get("/mcp/sse", async (req: express.Request, res: express.Response) => {
        const sessionHeader = req.headers["mcp-session-id"];
        const streamableSessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;

        if (streamableSessionId && streamableSessions.has(streamableSessionId)) {
            console.log(`[MCP] Streamable HTTP GET /mcp/sse`);
            await handleStreamableHttpRequest(req, res);
            return;
        }

        // ─────────────────────────────────────────────────────────────────
        // LEGACY: SSE Transport (for older clients / Cursor)
        // ─────────────────────────────────────────────────────────────────
        console.log(`[MCP] Legacy SSE GET /mcp/sse`);
        const token = getConnectionToken(req) || undefined;
        if (!token) {
            console.warn("[MCP] Connection without token — tool calls will fail at the proxy.");
        }

        const transport = new SSEServerTransport("/mcp/messages", res);
        const server = createMcpServer(token || "");
        await server.connect(transport);
        const legacySessionId = transport.sessionId;
        sseSessions.set(legacySessionId, { server, transport, token });
        console.log(`[MCP] Legacy SSE session ${legacySessionId} started. Token present: ${!!token}`);

        res.on('close', () => {
            console.log(`[MCP] Legacy SSE session ${legacySessionId} closed.`);
            sseSessions.delete(legacySessionId);
        });
    });

    app.head("/mcp/sse", async (_req: express.Request, res: express.Response) => {
        res.status(204).end();
    });

    // Message endpoint for legacy SSE sessions
    app.post("/mcp/messages", async (req: express.Request, res: express.Response) => {
        const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
        if (!sessionId) {
            return res.status(400).send("sessionId query parameter is required");
        }

        const session = sseSessions.get(sessionId);
        if (!session) {
            return res.status(404).send("Session not found or expired");
        }
        await session.transport.handlePostMessage(req, res, req.body);
    });
}
