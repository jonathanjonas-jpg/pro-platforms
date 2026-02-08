import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.post("/analyze-issue", async (req, res) => {
  try {
    const { title, description, comments } = req.body;

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      system: `
You are a Buildprint Engineering Troubleshooter.
You have access to Buildprint via MCP tools.
Identify pages, workflows, elements, root cause, and fix steps.
      `,
      messages: [
        {
          role: "user",
          content: `
Issue Title:
${title}

Description:
${description}

Recent Comments:
${comments}
          `,
        },
      ],
    });

    res.json({ result: response.content });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(3000, () => {
  console.log("Agent running on port 3000");
});
