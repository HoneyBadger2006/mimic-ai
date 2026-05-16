require('dotenv').config();

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-west-2",
});

const MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0";

/**
 * Score how well the person in the image is performing the given prompt.
 * @param {string} base64Image - Base64-encoded JPEG image (no data URI prefix)
 * @param {string} prompt - The expression/pose to evaluate (e.g. "make a dead face")
 * @returns {Promise<{score: number}>} Score from 0 to 100
 */
async function scoreImage(base64Image, prompt) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: base64Image,
            },
          },
          {
            type: "text",
            text:
              `You are a strict but fair judge for a facial expression game. ` +
              `The player was asked to: "${prompt}". ` +
              `Look at the person in the image and rate how accurately they are performing that expression or action. ` +
              `Reply with ONLY valid JSON in this exact format, no explanation: {"score": <integer 0-100>}`,
          },
        ],
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const raw = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const text = raw.content[0].text.trim();

  const parsed = JSON.parse(text);
  if (typeof parsed.score !== "number") {
    throw new Error(`Unexpected response shape: ${text}`);
  }

  return { score: Math.round(Math.min(100, Math.max(0, parsed.score))) };
}

/**
 * Send both frames to Claude and ask which player better matched the prompt.
 * @param {string} frame1 - Base64 JPEG for player 1 (no data URI prefix)
 * @param {string} frame2 - Base64 JPEG for player 2 (no data URI prefix)
 * @param {string} prompt - The expression challenge
 * @returns {Promise<{winner: 1|2}>}
 */
async function pickWinner(frame1, frame2, prompt) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 32,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: frame1 },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: frame2 },
          },
          {
            type: "text",
            text:
              `You are judging a facial expression contest. The challenge was: "${prompt}". ` +
              `The first image is Player 1, the second image is Player 2. ` +
              `Which player better matches the challenge? ` +
              `Reply with ONLY valid JSON, no explanation: {"winner": 1} or {"winner": 2}`,
          },
        ],
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const raw = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const text = raw.content[0].text.trim();
  const parsed = JSON.parse(text);

  if (parsed.winner !== 1 && parsed.winner !== 2) {
    throw new Error(`Unexpected winner value: ${text}`);
  }

  return { winner: parsed.winner };
}

module.exports = { scoreImage, pickWinner };
