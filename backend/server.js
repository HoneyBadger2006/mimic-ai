const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const { pickWinner, generatePrompt } = require("./src/scorer");

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || "*";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.static(path.join(__dirname, "../frontend/dist")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3001;

// roomId -> { players: [socketId, ...], frames: { socketId: base64 }, prompt: string }
const rooms = {};

const FALLBACK_PROMPTS = [
  "Show pure happiness! 😄",
  "Look totally terrified! 😱",
  "Make a face like you smell something awful! 🤢",
  "Look like you just won a million dollars! 🤑",
  "Show the saddest face ever! 😢",
  "Look absolutely furious! 😡",
  "Make a face like you saw a ghost! 👻",
  "Show total shock and disbelief! 😲",
  "Look like you tasted something disgusting! 🤮",
  "Make your most confused face! 🤔",
  "Look like you're about to cry! 😭",
  "Show extreme embarrassment! 😳",
  "Look so bored you could fall asleep! 😴",
  "Make a face like you got caught! 😬",
  "Show how hungry you are! 😋",
  "Look like you're freezing cold! 🥶",
  "Make a face like you smell something amazing! 😍",
  "Show pure excitement! 🤩",
  "Look like you just heard terrible news! 😔",
  "Make a face like something is way too spicy! 🌶️",
  "Show deep disappointment! 😞",
  "Look totally surprised! 😮",
  "Make a face like you won a trophy! 🏆",
  "Show you're trying not to laugh! 😂",
  "Look like you just bit a lemon! 🍋",
  "Make the most disgusted face! 😫",
  "Show pure love and joy! 🥰",
  "Look like something scared you! 😨",
  "Make a face like you are very suspicious! 🧐",
  "Show total exhaustion! 😩",
];

// Ring buffer of recent prompts to avoid repetition (max 15)
const recentPrompts = [];

function startCountdown(roomId) {
  let count = 3;
  io.to(roomId).emit("countdown", { count });

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      io.to(roomId).emit("countdown", { count });
    } else {
      clearInterval(timer);
      io.to(roomId).emit("take_photo");
    }
  }, 1000);
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── join_room ──────────────────────────────────────────────────────────────
  socket.on("join_room", ({ roomId }) => {
    if (!roomId) return;

    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], frames: {} };
    }

    const room = rooms[roomId];

    if (room.players.length >= 2) {
      socket.emit("error", { message: "Room is full." });
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`[join_room] ${socket.id} → room "${roomId}" (${room.players.length}/2)`);

    if (room.players.length === 2) {
      io.to(roomId).emit("game_start", { roomId, players: room.players });
      io.to(roomId).emit("prompt_ready", { prompt: "Generating challenge…" });

      generatePrompt([...recentPrompts])
        .then((prompt) => {
          rooms[roomId] && (rooms[roomId].prompt = prompt);
          io.to(roomId).emit("prompt_ready", { prompt });
          console.log(`[prompt] "${prompt}"`);
          recentPrompts.push(prompt);
          if (recentPrompts.length > 15) recentPrompts.shift();
          // 3s pose window, then 3s countdown
          setTimeout(() => startCountdown(roomId), 3000);
        })
        .catch((err) => {
          console.error("[generatePrompt] error:", err.message);
          const available = FALLBACK_PROMPTS.filter(p => !recentPrompts.includes(p));
          const pool = available.length > 0 ? available : FALLBACK_PROMPTS;
          const fallback = pool[Math.floor(Math.random() * pool.length)];
          rooms[roomId] && (rooms[roomId].prompt = fallback);
          io.to(roomId).emit("prompt_ready", { prompt: fallback });
          recentPrompts.push(fallback);
          if (recentPrompts.length > 15) recentPrompts.shift();
          setTimeout(() => startCountdown(roomId), 3000);
        });

      console.log(`[game_start] room "${roomId}" — generating prompt…`);
    }
  });

  // ── submit_frame ───────────────────────────────────────────────────────────
  socket.on("submit_frame", async ({ frame }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.frames[socket.id] = frame ?? null;

    console.log(
      `[submit_frame] ${socket.id} — frames received: ${Object.keys(room.frames).length}/2`
    );

    if (Object.keys(room.frames).length === 2) {
      const [p1, p2] = room.players;

      io.to(roomId).emit("judging");

      const f1 = room.frames[p1];
      const f2 = room.frames[p2];

      const toDataUri = (b64) => b64 ? `data:image/jpeg;base64,${b64}` : null;

      function emitGameOver(winner, s1, s2, scoredBy, tip1, tip2, error) {
        const p1Socket = io.sockets.sockets.get(p1);
        const p2Socket = io.sockets.sockets.get(p2);
        const base = { winner, scoredBy, prompt: room.prompt ?? null, ...(error ? { error } : {}) };
        p1Socket?.emit("game_over", { ...base, yourScore: s1, oppScore: s2, oppPhoto: toDataUri(f2), tip: tip1 });
        p2Socket?.emit("game_over", { ...base, yourScore: s2, oppScore: s1, oppPhoto: toDataUri(f1), tip: tip2 });
      }

      if (!f1 || !f2) {
        console.error("[submit_frame] One or both frames are empty — skipping AI scoring");
        const s1 = Math.floor(Math.random() * 101);
        const s2 = Math.floor(Math.random() * 101);
        emitGameOver(s1 >= s2 ? p1 : p2, s1, s2, "random", null, null, "Empty frame data");
        delete rooms[roomId];
        return;
      }

      try {
        const { winner: winnerIndex, score1, score2, tip1, tip2 } = await pickWinner(
          f1, f2,
          room.prompt ?? "Make your best surprised face!"
        );
        const winner = winnerIndex === 1 ? p1 : p2;
        console.log(`[game_over] room "${roomId}" — winner: ${winner} | scores: p1=${score1} p2=${score2} (AI scored)`);
        emitGameOver(winner, score1, score2, "ai", tip1, tip2);
      } catch (err) {
        console.error("[pickWinner] error:", err.message);
        const s1 = Math.floor(Math.random() * 101);
        const s2 = Math.floor(Math.random() * 101);
        console.log(`[game_over] room "${roomId}" — RANDOM fallback`);
        emitGameOver(s1 >= s2 ? p1 : p2, s1, s2, "random", null, null, err.message);
      }

      delete rooms[roomId];
    }
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.players = room.players.filter((pid) => pid !== socket.id);
    delete room.frames[socket.id];

    if (room.players.length === 0) {
      delete rooms[roomId];
    } else {
      io.to(roomId).emit("player_left", { playerId: socket.id });
    }
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.listen(PORT, () => {
  console.log(`Mimic-AI server running on http://localhost:${PORT}`);
});
