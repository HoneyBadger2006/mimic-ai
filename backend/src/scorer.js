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

const PROMPT_CATEGORIES = [
  "happiness or excitement: winning something, best news ever, can't stop smiling",
  "sadness or crying: just lost something, deeply disappointed, about to cry",
  "anger or frustration: furious, annoyed, fed up",
  "fear or shock: saw a ghost, jump scare, something terrifying",
  "disgust: something smells awful, tasted something terrible, saw something gross",
  "surprise: totally unexpected news, jaw drop, can't believe it",
  "embarrassment or guilt: caught doing something wrong, awkward moment, red-faced",
  "boredom or tiredness: falling asleep, completely uninterested, exhausted",
  "love or admiration: seeing a crush, something adorable, deeply touched",
  "confusion or disbelief: nothing makes sense, totally lost, what just happened",
];

/**
 * Ask Claude to generate a fresh mimic challenge visible on a webcam.
 * @param {string[]} recentPrompts - Prompts used recently to avoid repetition
 * @returns {Promise<string>} e.g. "Pretend you just saw a ghost 👻"
 */
async function generatePrompt(recentPrompts = []) {
  const category = PROMPT_CATEGORIES[Math.floor(Math.random() * PROMPT_CATEGORIES.length)];
  const avoidClause = recentPrompts.length > 0
    ? `\nDo NOT use any of these recently used challenges: ${recentPrompts.map(p => `"${p}"`).join(", ")}.`
    : "";

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 40,
    messages: [
      {
        role: "user",
        content:
          `Write a fun facial expression challenge for a photo game. Emotion category: ${category}. ` +
          `Rules: simple words only (anyone can understand); start with "Show" or "Look" or "Make a face like"; max 6 words + 1 emoji at the end. ` +
          `Examples: "Show pure happiness! 😄", "Look totally terrified! 😱", "Make a face like you smell something awful 🤢", "Look like you just won a million dollars! 🤑".` +
          avoidClause +
          ` Reply with ONLY the challenge text, nothing else.`,
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
