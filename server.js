const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// health check (important for Render)
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// placeholder endpoint Xano will call
app.post("/run", async (req, res) => {
  res.json({
    ok: true,
    received: req.body
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
