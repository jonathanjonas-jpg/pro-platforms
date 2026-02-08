import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export async function getMcpTools() {
  const transport = new SSEClientTransport(new URL(process.env.MCP_URL), {
    headers: process.env.MCP_TOKEN ? { Authorization: `Bearer ${process.env.MCP_TOKEN}` } : {},
  });

  const client = new Client({ name: "buildprint-runner", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  await client.close();

  return tools;
}

export async function callMcpTool(toolName, args) {
  const transport = new SSEClientTransport(new URL(process.env.MCP_URL), {
    headers: process.env.MCP_TOKEN ? { Authorization: `Bearer ${process.env.MCP_TOKEN}` } : {},
  });

  const client = new Client({ name: "buildprint-runner", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  await client.close();
  return result;
}
