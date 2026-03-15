import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { setupMcpRoutes } from './mcp/server.js';
import {
    createPhoenixOpenAiResponseRouter,
    serviceBackedPhoenixRuntimeEngine,
} from './phoenixai/index.js';

import { createMastraWorkflowRouter } from './mastra/routes/workflow.js';

dotenv.config();

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isEnabled(value: string | undefined): boolean {
    return ENABLED_VALUES.has(String(value ?? '').toLowerCase());
}

function maskSecret(value: string | undefined): string {
    if (!value) return '<unset>';
    if (value.length <= 8) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function sanitizeConnectionUri(value: string | undefined): string {
    if (!value) return '<unset>';
    const withoutQuery = value.split('?')[0] ?? value;
    return withoutQuery.replace(/\/\/([^/@]+)@/, '//***:***@');
}

function extractMongoDbName(value: string | undefined): string {
    if (!value) return '<unset>';
    const withoutQuery = value.split('?')[0] ?? value;
    const match = withoutQuery.match(/^[a-z0-9+.-]+:\/\/[^/]+\/([^/?]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '<none>';
}

function safeNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function logStartupConfig(port: number): void {
    const effectiveProvider = process.env.PHOENIX_AI_PROVIDER || process.env.PROVIDER || 'openai';
    const streamRaw = process.env.PHX_USE_STREAM ?? process.env.PHOENIX_USE_STREAM;
    const baseUrl = `http://localhost:${port}`;
    const configSummary = {
        runtime: {
            PORT: port,
            NODE_ENV: process.env.NODE_ENV || 'development',
            STREAM_FLAG_RAW: streamRaw ?? '<unset>',
            PHOENIX_STREAM_ENABLED: isEnabled(streamRaw),
            PHOENIX_USE_OPENAI_RESPONSE_API: isEnabled(process.env.PHOENIX_USE_OPENAI_RESPONSE_API),
        },
        provider: {
            PROVIDER: process.env.PROVIDER || '<unset>',
            PHOENIX_AI_PROVIDER: process.env.PHOENIX_AI_PROVIDER || '<unset>',
            EFFECTIVE_PROVIDER: effectiveProvider,
            OPENAI_API_KEY: maskSecret(process.env.OPENAI_API_KEY),
        },
        models: {
            INTENT_SELECTOR_MODEL: process.env.INTENT_SELECTOR_MODEL || '<unset>',
            OPENAI_SUMMARY_MODEL: process.env.OPENAI_SUMMARY_MODEL || '<unset>',
            OPENAI_QUERY_MODEL: process.env.OPENAI_QUERY_MODEL || 'gpt-5',
            OPENAI_AMBIGUITY_MODEL: process.env.OPENAI_AMBIGUITY_MODEL || 'gpt-5-mini',
            OPENAI_EMBED_MODEL: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
            OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT || 'low',
        },
        persistence: {
            SKYLARK_MONGODB_URI: sanitizeConnectionUri(process.env.SKYLARK_MONGODB_URI),
            SKYLARK_DB_NAME: extractMongoDbName(process.env.SKYLARK_MONGODB_URI),
        },
        querySource: {
            PHOENIX_MONGO_URI: sanitizeConnectionUri(process.env.PHOENIX_MONGO_URI || process.env.MONGODB_URI),
            PHOENIX_DB_NAME: extractMongoDbName(process.env.PHOENIX_MONGO_URI || process.env.MONGODB_URI),
        },
        vector: {
            USE_QDRANT_VECTOR_DB: isEnabled(process.env.USE_QDRANT_VECTOR_DB),
            QDRANT_URL: process.env.QDRANT_URL || '<unset>',
            QDRANT_API_KEY: maskSecret(process.env.QDRANT_API_KEY),
            INDEX_NAME_PMS_COLLECTIONS: process.env.INDEX_NAME_PMS_COLLECTIONS || '<unset>',
            RAG_TOPK: safeNumber(process.env.RAG_TOPK, 8),
        },
        endpoints: {
            MCP_STREAMABLE: `${baseUrl}/mcp`,
            MCP_SSE_LEGACY: `${baseUrl}/mcp/sse`,
            PHOENIX_API: `${baseUrl}/api/phoenix-openai`,
            PHOENIX_QUERY_STREAM: `${baseUrl}/api/phoenix-openai/query/stream`,
        },
    };

    console.log('\n🧭 SkylarkAI startup config summary (.env → effective runtime)');
    console.log(JSON.stringify(configSummary, null, 2));
}

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10) || 4000;

// Match PhoenixCloudBE security middleware patterns
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Use helmet with patterns from PhoenixCloudBE
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", "https:", "wss:", "http://localhost:*", "https://localhost:*", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Use CORS exactly as PhoenixCloudBE does in dev, but allow all origins for the proxy
app.use(cors({
    origin: (origin, callback) => {
        // Explicitly allow null (for local file loads) and any localhost
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('https://localhost')) {
            callback(null, true);
        } else {
            callback(null, true); // Still allow others for now to be safe
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Cookie",
        "X-Session-ID",
        "Mcp-Session-Id",
        "mcp-session-id",
        "Mcp-Protocol-Version",
        "mcp-protocol-version",
        "Last-Event-ID",
        "last-event-id",
        "X-Requested-With"
    ],
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id"],
}));

// Request Logger (for debugging)
app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url} (Origin: ${req.headers.origin})`);
    next();
});

// Mount MCP routes
setupMcpRoutes(app);

// Mount Phoenix one-shot runtime routes
app.use('/api/phoenix-openai', createPhoenixOpenAiResponseRouter(serviceBackedPhoenixRuntimeEngine));

// Mount Mastra workflow routes
app.use('/api/mastra', createMastraWorkflowRouter());

app.listen(PORT, () => {
    console.log(`\n🚀 SkylarkAI Backend is LIVE on port ${PORT}`);
    console.log(`============================================`);
    logStartupConfig(PORT);
    console.log(`📍 MCP Streamable Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`📍 MCP Legacy SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
    console.log(`📍 Phoenix API Endpoint: http://localhost:${PORT}/api/phoenix-openai`);
    console.log(`📍 Phoenix Query Stream: http://localhost:${PORT}/api/phoenix-openai/query/stream`);
    console.log(`============================================\n`);
});
