const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();

// Increase limit because Bubble/MCP context can be large
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---- helpers ----
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Lazy-load MCP SDK (works in CommonJS even if SDK is ESM)
async function getMcpClient() {
  if (!process.env.MCP_URL) {
    throw new Error("Missing MCP_URL env var");
  }

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { SSEClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/sse.js"
  );

  const headers = {};
  if (process.env.MCP_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MCP_TOKEN}`;
  }

  const transport = new SSEClientTransport(new URL(process.env.MCP_URL), {
    headers,
  });

  const client = new Client({ name: "buildprint-runner", version: "1.0.0" });
  await client.connect(transport);

  return client;
}

async function listMcpTools() {
  const client = await getMcpClient();
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

async function callMcpTool(name, args) {
  const client = await getMcpClient();
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

// ---- routes ----

// health check (important for Render)
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// one-time: discover tool names your MCP server exposes
app.get("/mcp-tools", async (req, res) => {
  try {
    const tools = await withTimeout(listMcpTools(), 20_000);
    res.json({ ok: true, tools });
  } catch (error) {
    console.error("MCP tools error:", error);
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// main AI endpoint
app.post("/run", async (req, res) => {
  try {
    const {
      taskTitle,
      taskDescription,
      comments, // optional if you send from Xano
      labels,   // optional if you send from Xano
      issueId,  // optional if you send from Xano
    } = req.body || {};

    const issueText = [
      issueId ? `IssueId:\n${issueId}` : null,
      `Task Title:\n${taskTitle || ""}`,
      `Task Description:\n${taskDescription || ""}`,
      labels ? `Labels:\n${JSON.stringify(labels)}` : null,
      comments ? `Comments:\n${JSON.stringify(comments)}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    // --- Pull Bubble/Buildprint context via MCP ---
    if (!process.env.MCP_TOOL_NAME) {
      throw new Error(
        "Missing MCP_TOOL_NAME env var. Hit /mcp-tools, choose the correct tool name, set MCP_TOOL_NAME, redeploy."
      );
    }

    // Many MCP servers accept { query }, but if yours uses different args,
    // change this object accordingly.
    const bubbleCtx = await withTimeout(
      callMcpTool(process.env.MCP_TOOL_NAME, { query: issueText }),
      60_000
    );

    const prompt = `
You are a troubleshooting assistant for the bubble engineering team.

Use the Buildprint/Bubble context (from MCP) to be specific. If the MCP context does not contain what you need, say so.

Task:
${issueText}

Buildprint/Bubble Context (from MCP tool "${process.env.MCP_TOOL_NAME}"):
${JSON.stringify(bubbleCtx, null, 2)}

Explain:
1. What pages are likely involved
2. What workflows are likely involved
3. What elements may need review
4. Suggested solution steps
5. What other workflows, elements and pages could be effected

Keep your responses short and to the point, no fluff. Don't guess—if you don't know something for certain say so and provide level of confidence.
`;

    const message = await withTimeout(
      anthropic.messages.create({
        // keep your working model, but allow override via env var
        model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
      90_000
    );

    res.json({
      ok: true,
      response: message.content[0].text,
    });
  } catch (error) {
    console.error("AI failed:", error);
    res.status(500).json({
      ok: false,
      error: "AI failed",
      message: error.message || String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
