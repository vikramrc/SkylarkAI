import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { setupMcpRoutes } from './mcp/server.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

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

app.listen(PORT, () => {
    console.log(`\n🚀 SkylarkAI Backend is LIVE on port ${PORT}`);
    console.log(`============================================`);
    console.log(`📍 MCP Streamable Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`📍 MCP Legacy SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
    console.log(`============================================\n`);
});
