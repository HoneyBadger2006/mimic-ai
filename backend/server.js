const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../frontend")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3001;

// roomId -> { players: [socketId, ...], frames: { socketId: frameData } }
const rooms = {};

const PROMPT = "Make your best surprised face! 😲";

// Mock scorer: returns a random score 0–100
function mockScore() {
  return Math.floor(Math.random() * 101);
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

    // Reject a third player
    if (room.players.length >= 2) {
      socket.emit("error", { message: "Room is full." });
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`[join_room] ${socket.id} → room "${roomId}" (${room.players.length}/2)`);

    // Both players present → start the game
    if (room.players.length === 2) {
      // game_start
      io.to(roomId).emit("game_start", {
        roomId,
        players: room.players,
      });

      // prompt_ready — sent immediately after game_start
      io.to(roomId).emit("prompt_ready", {
        prompt: PROMPT,
      });

      console.log(`[game_start + prompt_ready] room "${roomId}"`);
    }
  });

  // ── submit_frame ───────────────────────────────────────────────────────────
  socket.on("submit_frame", ({ frame }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.frames[socket.id] = frame ?? null;

    console.log(
      `[submit_frame] ${socket.id} — frames received: ${Object.keys(room.frames).length}/2`
    );

    // Both frames in → score and end game
    if (Object.keys(room.frames).length === 2) {
      const scores = {};
      room.players.forEach((pid) => {
        scores[pid] = mockScore();
      });

      // Emit individual score_result to each player
      room.players.forEach((pid) => {
        io.to(pid).emit("score_result", {
          playerId: pid,
          score: scores[pid],
        });
      });

      // Determine winner (ties go to first player)
      const [p1, p2] = room.players;
      const winner = scores[p1] >= scores[p2] ? p1 : p2;

      io.to(roomId).emit("game_over", {
        winner,
        scores,
      });

      console.log(
        `[game_over] room "${roomId}" — winner: ${winner} | scores: ${JSON.stringify(scores)}`
      );

      // Clean up room so it can be reused
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
      // Notify remaining player
      io.to(roomId).emit("player_left", { playerId: socket.id });
    }
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.listen(PORT, () => {
  console.log(`Mimic-AI server running on http://localhost:${PORT}`);
});
