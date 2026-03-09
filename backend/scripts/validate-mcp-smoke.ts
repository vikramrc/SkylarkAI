const BASE_URL = process.argv[2] ?? process.env.MCP_BASE_URL ?? "http://localhost:4000";
const ORIGIN = "http://localhost:8080";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isOpenAiSafeToolName(name: string) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

async function preflight(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,mcp-session-id,mcp-protocol-version"
    }
  });

  assert(response.headers.get("access-control-allow-origin") === ORIGIN, `${path} missing CORS allow-origin`);
  console.log(`✓ preflight ${path}`);
}

async function head(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "HEAD",
    headers: { Origin: ORIGIN }
  });

  assert(response.status === 204, `${path} HEAD expected 204, got ${response.status}`);
  console.log(`✓ head ${path}`);
}

async function initialize(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "mcp-smoke", version: "1.0.0" }
      }
    })
  });

  const body = await response.text();
  assert(response.ok, `${path} initialize failed: ${response.status} ${body}`);
  const sessionId = response.headers.get("mcp-session-id");
  assert(sessionId, `${path} initialize did not return mcp-session-id`);
  console.log(`✓ initialize ${path} -> ${sessionId}`);
  return sessionId;
}

async function stream(path: string, sessionId: string) {
  const controller = new AbortController();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Origin: ORIGIN,
      Accept: "text/event-stream",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": "2025-03-26"
    },
    signal: controller.signal
  });

  assert(response.ok, `${path} stream failed with ${response.status}`);
  assert(response.headers.get("content-type")?.includes("text/event-stream"), `${path} stream missing event-stream content type`);
  controller.abort();
  console.log(`✓ stream ${path}`);
}

async function listTools(path: string, sessionId: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });

  const body = await response.text();
  assert(response.ok, `${path} tools/list failed: ${response.status} ${body}`);
  const match = body.match(/data: (.+)/);
  assert(match, `${path} tools/list missing SSE payload: ${body}`);
  const payload = JSON.parse(match[1]);
  const tools = payload?.result?.tools;
  assert(Array.isArray(tools) && tools.length > 0, `${path} tools/list returned no tools`);
  assert(tools.every((tool: { name?: string }) => typeof tool.name === "string" && isOpenAiSafeToolName(tool.name)), `${path} tools/list returned non OpenAI-safe tool names`);
  console.log(`✓ tools/list ${path} -> ${tools.length} tools`);
}

async function readFirstSseEvent(response: Response) {
  const reader = response.body?.getReader();
  assert(reader, "SSE response body is not readable");
  const decoder = new TextDecoder();
  let text = "";

  while (!text.includes("\n\n")) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > 4096) break;
  }

  return { text, reader };
}

async function legacySse() {
  const response = await fetch(`${BASE_URL}/mcp/sse`, {
    headers: {
      Origin: ORIGIN,
      Accept: "text/event-stream"
    }
  });

  assert(response.ok, `legacy SSE connect failed with ${response.status}`);
  const { text, reader } = await readFirstSseEvent(response);
  const match = text.match(/data: (\/mcp\/messages\?sessionId=[^\n\r]+)/);
  assert(match, `legacy SSE did not advertise a message endpoint: ${text}`);

  const postResponse = await fetch(`${BASE_URL}${match[1]}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });

  const postBody = await postResponse.text();
  assert(postResponse.status === 202, `legacy SSE message POST failed: ${postResponse.status} ${postBody}`);
  await reader.cancel();
  console.log(`✓ legacy SSE ${match[1]}`);
}

async function main() {
  console.log(`Smoke testing MCP transport at ${BASE_URL}`);
  await preflight("/mcp");
  await preflight("/mcp/sse");
  await head("/mcp/");

  const streamableSession = await initialize("/mcp");
  await stream("/mcp", streamableSession);
  await listTools("/mcp", streamableSession);

  const aliasSession = await initialize("/mcp/sse");
  await stream("/mcp/sse", aliasSession);
  await listTools("/mcp/sse", aliasSession);

  await legacySse();
  console.log("✓ MCP smoke test passed");
}

main().catch((error) => {
  console.error("MCP smoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});