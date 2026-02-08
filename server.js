const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});  
// health check (important for Render)
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// main AI endpoint
app.post("/run", async (req, res) => {
  try {
    const { taskTitle, taskDescription } = req.body;

    const prompt = `
You are a troubleshooting assistant for the engineering team.

Task Title:
${taskTitle}

Task Description:
${taskDescription}

Explain:
1. What pages are likely involved
2. What workflows are likely involved
3. What elements may need review
4. Suggested solution steps
`;

    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages: [
        { role: "user", content: prompt }
      ]
    });

    res.json({
      ok: true,
      response: message.content[0].text
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI failed" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
