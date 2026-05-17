require('dotenv').config();

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const clientConfig = {
  region: process.env.AWS_REGION || "us-west-2",
};

// Use bearer token if provided, otherwise fall back to IAM credentials
if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
  clientConfig.token = async () => ({ token: process.env.AWS_BEARER_TOKEN_BEDROCK });
}

const client = new BedrockRuntimeClient(clientConfig);

const MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

/**
 * Score how well the person in the image is performing the given prompt.
 * @param {string} base64Image - Base64-encoded JPEG image (no data URI prefix)
 * @param {string} prompt - The expression/pose to evaluate
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
  const text = raw.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

  const parsed = JSON.parse(text);
  if (typeof parsed.score !== "number") {
    throw new Error(`Unexpected response shape: ${text}`);
  }

  return { score: Math.round(Math.min(100, Math.max(0, parsed.score))) };
}

/**
 * Send both frames to Claude, get individual accuracy scores + winner in one call.
 * @param {string} frame1 - Base64 JPEG for player 1 (no data URI prefix)
 * @param {string} frame2 - Base64 JPEG for player 2 (no data URI prefix)
 * @param {string} prompt - The expression challenge
 * @returns {Promise<{winner: 1|2, score1: number, score2: number, tip1: string, tip2: string}>}
 */
async function pickWinner(frame1, frame2, prompt) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 300,
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
              `Score each player 0-100 on how accurately they performed the challenge, pick the winner, ` +
              `and give each player one short specific tip (under 15 words) on how to improve next time. ` +
              `Reply with ONLY valid JSON, no explanation: {"winner": 1 or 2, "score1": <0-100>, "score2": <0-100>, "tip1": "<tip for player 1>", "tip2": "<tip for player 2>"}`,
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
  const text = raw.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(text);

  if (parsed.winner !== 1 && parsed.winner !== 2) {
    throw new Error(`Unexpected winner value: ${text}`);
  }

  return {
    winner: parsed.winner,
    score1: Math.round(Math.min(100, Math.max(0, parsed.score1 ?? 50))),
    score2: Math.round(Math.min(100, Math.max(0, parsed.score2 ?? 50))),
    tip1: parsed.tip1 ?? null,
    tip2: parsed.tip2 ?? null,
  };
}

/**
 * Ask Claude to generate a fresh mimic challenge visible on a webcam.
 * @returns {Promise<string>} e.g. "Pretend you just saw a ghost 👻"
 */
async function generatePrompt() {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 40,
    messages: [
      {
        role: "user",
        content:
          `Generate a short, fun challenge for a webcam mimic game. ` +
          `It must be something clearly visible on a face or with hands — ` +
          `like an expression, reaction, or simple pose. ` +
          `Be creative and varied: mix emotions, movie moments, everyday reactions. ` +
          `Reply with ONLY the challenge text (under 10 words), add one relevant emoji at the end.`,
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
  return raw.content[0].text.trim();
}

module.exports = { scoreImage, pickWinner, generatePrompt };
