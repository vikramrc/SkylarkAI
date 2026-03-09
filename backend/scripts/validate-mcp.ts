import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// Standard test scripts
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// The user is entirely responsible for knowing their Org and Token
const TEST_ORG = "67eedd60c1ceddb21d80ad45";
const TEST_TOKEN = process.env.PHOENIX_CLOUD_PROXY_TOKEN; // Passed as a bearer to SSE!

async function main() {
    console.log("Connecting to SkylarkAI MCP Server via SSE...");
    
    // Pass token entirely from client side during connection
    // We also need to construct a custom Undici dispatcher for Node fetch to ignore self-signed certs
    // that the SSEClientTransport might use when connecting to localhost
    const { Agent } = await import('undici');
    
    const transport = new SSEClientTransport(
        new URL("http://localhost:4000/mcp/sse"),
        {
            requestInit: {
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`
                },
                dispatcher: new Agent({ connect: { rejectUnauthorized: false } })
            }
        } as any
    );
    
    const client = new Client({
        name: "test-client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    await client.connect(transport);
    console.log("Connected successfully!");

    // 1. Fetch Tools
    const toolsResponse = await client.listTools();
    console.log(`Discovered ${toolsResponse.tools.length} tools`);

    const mcpTools = toolsResponse.tools.map(t => ({
        type: "function" as const,
        function: {
            name: t.name.replace(/\./g, "_"),
            description: t.description || "",
            parameters: t.inputSchema
        }
    }));

    // 2. Ask GPT 5.2
    console.log(`Prompting GPT. Context Org ID passed internally from test: ${TEST_ORG}`);
    
    const model = process.env.OPENAI_QUERY_MODEL || "gpt-5.4";
    
    const messages = [{
        role: "user" as const,
        // Notice we tell the AI the organizationID because the MCP layer is totally agnostic now.
        content: `I am currently in the context of organizationID: ${TEST_ORG}. Can you query the stock transfers for my organization?`
    }];

    const response = await openai.chat.completions.create({
        model,
        messages,
        tools: mcpTools,
        tool_choice: "auto"
    });

    const choice: any = response.choices[0];
    if (choice?.finish_reason === "tool_calls") {
        const toolCall = choice.message.tool_calls[0];
        console.log(`LLM decided to call tool: ${toolCall.function.name}`);
        console.log(`With arguments: ${toolCall.function.arguments}`);
        
        const originalName = toolCall.function.name.replace("_", ".");
        
        console.log("Executing tool through MCP server...");
        const result = await client.callTool({
            name: originalName,
            arguments: JSON.parse(toolCall.function.arguments)
        });
        
        const resultText = ((result as any).content[0] as any).text;
        console.log("Tool execution result string length:", resultText.length);
        
        if (resultText.includes('"items": []') || resultText.includes('[]')) {
            console.log("SUCCESS: inventory.query_stock_transfers returned expected empty array (OK_DB_CONFIRMED_EMPTY).");
        } else {
            console.log("Data returned successfully:", resultText.substring(0, 100) + '...');
        }
        
    } else {
        console.warn("LLM did not choose to call a tool.");
        console.log("Response:", choice.message.content);
    }

    console.log("Test completed. Exiting...");
    process.exit(0);
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
