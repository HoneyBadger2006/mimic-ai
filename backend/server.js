const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const { pickWinner } = require("./src/scorer");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../frontend")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3001;

// roomId -> { players: [socketId, ...], frames: { socketId: base64 } }
const rooms = {};

const PROMPT = "Make your best surprised face! 😲";

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
      io.to(roomId).emit("prompt_ready", { prompt: PROMPT });
      startCountdown(roomId);
      console.log(`[game_start] room "${roomId}" — countdown started`);
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

      try {
        const { winner: winnerIndex } = await pickWinner(
          room.frames[p1],
          room.frames[p2],
          PROMPT
        );
        const winner = winnerIndex === 1 ? p1 : p2;
        console.log(`[game_over] room "${roomId}" — winner: ${winner}`);
        io.to(roomId).emit("game_over", { winner });
      } catch (err) {
        console.error("[pickWinner] error:", err);
        // fallback: random winner
        const winner = room.players[Math.floor(Math.random() * 2)];
        io.to(roomId).emit("game_over", { winner });
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
