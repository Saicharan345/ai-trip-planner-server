import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.GOOGLE_API_KEY;

// Retry helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 3;

function cleanOutput(text) {
  if (!text) return "";

  return text
    .replace(/\*\*/g, "")           // remove bold markdown stars
    .replace(/\*/g, "")             // remove bullets/stars
    .replace(/_{1,2}/g, "")         // remove underline markdown
    .replace(/^#{1,6}\s?/gm, "")    // remove headings like "##"
    .replace(/-{3,}/g, "")          // remove long separators ---
    .replace(/>\s?/g, "")           // remove blockquotes >
    .replace(/\n{3,}/g, "\n\n")     // fix spacing
    .trim();
}
app.post("/generate", async (req, res) => {
  const { fromCity, destination, budget, days, groupType, transport } = req.body;

  if (!API_KEY) {
    console.error("GOOGLE_API_KEY missing");
    return res.status(500).json({ error: "API key missing on server." });
  }

  if (!fromCity || !destination || !budget || !days) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const prompt = `
Create a detailed ${days}-day travel plan.

TRAVEL DETAILS:
- From: ${fromCity}
- To: ${destination}
- Transport Mode: ${transport}
- Group Type: ${groupType}
- Budget: ₹${budget}
- Days: ${days}

REQUIREMENTS:
1. Day-wise full itinerary (morning, afternoon, evening).
2. Best transport suggestions based on mode: ${transport}.
3. Include approximate travel cost from ${fromCity} to ${destination}.
4. Food recommendations (cheap + famous options).
5. Must follow the group type (${groupType}) for stay, food, and activities.
6. Very detailed cost breakdown for:
   - Travel
   - Food
   - Accommodation
   - Local transport
   - Extras
7. Make it realistic and easy to follow.
8. Keep recommendations low-cost to fit within ₹${budget} budget.
      `;

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
        {
          contents: [
            { parts: [{ text: prompt }] }
          ]
        }
      );

      const candidate = response.data?.candidates?.[0];
      const generatedText = candidate?.content?.parts?.[0]?.text;

      if (generatedText) {
    const cleaned = cleanOutput(generatedText);
    return res.json({ plan: cleaned });
}

      if (candidate?.finishReason === "SAFETY") {
        return res.status(400).json({ error: "Blocked by safety filter." });
      }

      return res.status(500).json({ error: "Model returned empty response." });

    } catch (err) {
      const is503 = err.response?.status === 503;

      if (is503 && attempt < MAX_RETRIES - 1) {
        const delay = 1000 * (attempt + 1);
        console.log(`Retry ${attempt + 1} after 503. Waiting ${delay}ms`);
        await sleep(delay);
        attempt++;
        continue;
      }

      console.error("FINAL ERROR:", err.response?.data || err);
      return res.status(500).json({
        error: err.response?.data?.error?.message || "Server error."
      });
    }
  }
});

app.listen(5000, () => {
  console.log("✔ Backend running on port 5000");
});
