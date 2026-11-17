const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.redirect("/index.html");
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || Array.isArray(message)) {
      return res.status(400).json({ 
        error: "Message harus berupa Array"
      });
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },

        body: JSON.stringify({
          model: "inclusionai/ling-3.2-flash:free",
          messages: message,
          temperature: 0.7,
          max_tokens: 1000,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("OpenRouter API Error:", errorData);
      return res.status(response.status).json({ error: errorData });
    }