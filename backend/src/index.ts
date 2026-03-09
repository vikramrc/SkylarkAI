import express from 'express';
import dotenv from 'dotenv';
import { setupMcpRoutes } from './mcp/server.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Need to allow POSTs to be JSON. However, MCP SSE expects raw SSE requests. We'll parse JSON normally for other routes.
// But the MCP transport handles its own body parsing if we pass req/res.
// Wait, for SSE, the @modelcontextprotocol/sdk Express integration gives us a transport handler.
// Actually, let's just use the server's HTTP router if they have one, or build a simple SSE setup.
// Wait! Let's just create a basic Express server and mount standard MCP SSE routes.

app.use(express.json());

let transport;

app.get('/mcp/sse', async (req, res) => {
    // We'll set up the SSE transport when connecting.
});

app.post('/mcp/messages', async (req, res) => {
    // Handle messages
});

// We will implement the actual transport connections inside server.js because it's cleaner.
setupMcpRoutes(app);

app.listen(PORT, () => {
    console.log(`SkylarkAI Backend running on port ${PORT}`);
    console.log(`MCP server available at http://localhost:${PORT}/mcp/sse`);
});

