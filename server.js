const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---- helpers ----
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

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

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/mcp-tools", async (req, res) => {
  try {
    console.log("Attempting MCP connection...");
    console.log("MCP_URL:", process.env.MCP_URL);
    console.log("MCP_TOKEN:", process.env.MCP_TOKEN ? "***set***" : "NOT SET");
    
    const tools = await withTimeout(listMcpTools(), 20_000);
    res.json({ ok: true, tools });
  } catch (error) {
    console.error("Full MCP error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      ok: false, 
      error: error.message || String(error),
      stack: error.stack,
      url: process.env.MCP_URL,
      hasToken: !!process.env.MCP_TOKEN
    });
  }
});

//Debug Endpoint
app.get("/debug-mcp", async (req, res) => {
  try {
    console.log("=== MCP Debug ===");
    console.log("MCP_URL:", process.env.MCP_URL);
    console.log("MCP_TOKEN exists:", !!process.env.MCP_TOKEN);
    
    if (!process.env.MCP_URL) {
      return res.json({ 
        error: "MCP_URL not set in environment variables" 
      });
    }

    // Test URL parsing
    let url;
    try {
      url = new URL(process.env.MCP_URL);
      console.log("Parsed URL:", {
        protocol: url.protocol,
        host: url.host,
        pathname: url.pathname
      });
    } catch (e) {
      return res.json({ 
        error: "Invalid MCP_URL format", 
        details: e.message,
        url: process.env.MCP_URL
      });
    }

    // Try to connect
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );

    const headers = {};
    if (process.env.MCP_TOKEN) {
      headers.Authorization = `Bearer ${process.env.MCP_TOKEN}`;
    }

    console.log("Creating transport with headers:", Object.keys(headers));
    const transport = new SSEClientTransport(url, { headers });

    console.log("Creating client...");
    const client = new Client({ 
      name: "buildprint-runner", 
      version: "1.0.0" 
    });

    console.log("Attempting to connect...");
    await withTimeout(client.connect(transport), 10_000);
    
    console.log("Connected! Listing tools...");
    const tools = await withTimeout(client.listTools(), 10_000);
    
    await client.close();
    
    res.json({
      ok: true,
      message: "MCP connection successful!",
      toolCount: tools.tools?.length || 0,
      toolNames: tools.tools?.map(t => t.name) || []
    });

  } catch (error) {
    console.error("Debug error:", error);
    res.json({
      ok: false,
      error: error.message || String(error),
      errorType: error.constructor.name,
      stack: error.stack,
      env: {
        hasUrl: !!process.env.MCP_URL,
        hasToken: !!process.env.MCP_TOKEN,
        url: process.env.MCP_URL
      }
    });
  }
});

app.get("/test-mcp-reachability", async (req, res) => {
  try {
    // Try a simple fetch to the MCP URL
    const response = await fetch(process.env.MCP_URL, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      }
    });

    const text = await response.text();
    
    res.json({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyPreview: text.substring(0, 500),
      bodyLength: text.length
    });
  } catch (error) {
    res.json({
      ok: false,
      error: error.message,
      code: error.code,
      stack: error.stack
    });
  }
});

app.get("/test-sse-raw", async (req, res) => {
  try {
    const { default: fetch } = await import('node-fetch');
    
    console.log("Testing SSE connection to:", process.env.MCP_URL);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(process.env.MCP_URL, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers.raw());

    if (!response.ok) {
      const errorText = await response.text();
      return res.json({
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorText
      });
    }

    // Try to read first chunk of SSE stream
    const reader = response.body;
    let chunk = '';
    
    for await (const data of reader) {
      chunk += data.toString();
      if (chunk.length > 1000) break; // Just get first bit
    }

    res.json({
      ok: true,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      firstChunk: chunk,
      message: "SSE stream is accessible"
    });

  } catch (error) {
    res.json({
      ok: false,
      error: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
  }
});

app.get("/test-sse-stream", async (req, res) => {
  try {
    const url = process.env.MCP_URL;
    console.log("Opening SSE stream to:", url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      return res.json({
        ok: false,
        status: response.status,
        body: await response.text()
      });
    }

    console.log("Stream opened, reading events...");
    
    // Read the stream for 5 seconds and collect events
    const events = [];
    const timeout = setTimeout(() => {
      console.log("Timeout reached");
    }, 5000);

    const reader = response.body;
    let buffer = '';
    
    try {
      for await (const chunk of reader) {
        buffer += chunk.toString();
        
        // Parse SSE events (split by double newline)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // Keep incomplete event in buffer
        
        for (const part of parts) {
          if (part.trim()) {
            events.push(part);
            console.log("Received event:", part);
          }
        }
        
        if (events.length >= 5) break; // Got enough events
      }
    } catch (e) {
      console.log("Stream read ended:", e.message);
    }

    clearTimeout(timeout);

    res.json({
      ok: true,
      message: "Successfully read SSE stream",
      eventCount: events.length,
      events: events,
      remainingBuffer: buffer
    });

  } catch (error) {
    console.error("Stream error:", error);
    res.json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
});

//end debug endpoint

// NEW: Agentic loop implementation
app.post("/run", async (req, res) => {
  try {
    const {
      taskTitle,
      taskDescription,
      comments,
      labels,
      issueId,
    } = req.body || {};

    const issueText = [
      issueId ? `Issue ID: ${issueId}` : null,
      `Title: ${taskTitle || ""}`,
      `Description: ${taskDescription || ""}`,
      labels ? `Labels: ${JSON.stringify(labels)}` : null,
      comments ? `Comments: ${JSON.stringify(comments)}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    // --- Get MCP tools and format for Claude ---
    let mcpTools = [];
    let mcpAvailable = true;
    
    try {
      const toolsList = await withTimeout(listMcpTools(), 20_000);
      mcpTools = toolsList.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }));
    } catch (error) {
      console.error("Failed to fetch MCP tools:", error);
      mcpAvailable = false;
    }

    // --- Build initial prompt ---
    const systemPrompt = mcpAvailable 
      ? `You are a troubleshooting assistant for the Bubble engineering team.

You have access to tools that query the Buildprint/Bubble application context. Use these tools to gather specific information about pages, workflows, elements, and logs relevant to the issue.

Guidelines:
- Use tools strategically to gather context before providing suggestions
- If you need app structure, use get_json or get_tree
- If you need logs/debugging info, use get_simple_logs or get_advanced_logs
- If you need guidelines/best practices, use get_guidelines
- Be specific about which pages, workflows, and elements are involved
- If tools don't return what you need, say so clearly
- Keep responses short and to the point, no fluff
- Don't guess—if you don't know something for certain, say so and provide level of confidence`
      : `You are a troubleshooting assistant for the Bubble engineering team.

⚠️ Bubble context tools are currently unavailable. Provide general guidance without specific Bubble app references.

Keep responses short and to the point. Clearly state that you don't have access to the specific app context.`;

    const userPrompt = `Analyze this issue and provide troubleshooting guidance:

${issueText}

Explain:
1. What pages are likely involved
2. What workflows are likely involved
3. What elements may need review
4. Suggested solution steps
5. What other workflows, elements and pages could be affected`;

    // --- Agentic loop ---
    const messages = [{ role: "user", content: userPrompt }];
    let response;
    let iterations = 0;
    const MAX_ITERATIONS = 10; // Prevent infinite loops

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      response = await withTimeout(
        anthropic.messages.create({
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          tools: mcpAvailable ? mcpTools : undefined,
          messages: messages,
        }),
        90_000
      );

      // Check if Claude wants to use tools
      if (response.stop_reason === "tool_use") {
        console.log(`Iteration ${iterations}: Claude requesting tools`);
        
        // Extract tool calls
        const toolUses = response.content.filter(block => block.type === "tool_use");
        
        // Add assistant response to conversation
        messages.push({
          role: "assistant",
          content: response.content,
        });

        // Execute each tool call
        const toolResults = [];
        for (const toolUse of toolUses) {
          console.log(`Calling MCP tool: ${toolUse.name}`);
          
          try {
            const result = await withTimeout(
              callMcpTool(toolUse.name, toolUse.input),
              60_000
            );
            
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result.content),
            });
          } catch (error) {
            console.error(`Tool ${toolUse.name} failed:`, error);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({
                error: error.message || String(error),
              }),
              is_error: true,
            });
          }
        }

        // Add tool results to conversation
        messages.push({
          role: "user",
          content: toolResults,
        });

      } else {
        // Claude is done
        console.log(`Completed in ${iterations} iteration(s)`);
        break;
      }
    }

    // Extract final text response
    const finalText = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n");

    res.json({
      ok: true,
      response: finalText,
      metadata: {
        iterations,
        mcp_available: mcpAvailable,
        tools_used: messages
          .filter(m => m.role === "assistant")
          .flatMap(m => m.content.filter(c => c.type === "tool_use"))
          .map(t => t.name),
      },
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
