# Mimic-AI

A 2-player face challenge web game. Players join a room, receive a facial expression prompt, submit a webcam frame, and get scored on how well they mimicked the prompt.

## Project Structure

```
mimic-ai/
├── frontend/   # React/HTML client with webcam capture
└── backend/    # Node.js + Express + Socket.io game server
```

## Quick Start

### Backend
```bash
cd backend
npm install
node server.js
```

### Frontend
Open `frontend/index.html` in a browser (or run a dev server).

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_room` | Client → Server | Player joins a named room |
| `game_start` | Server → Client | Emitted to both players when room is full |
| `prompt_ready` | Server → Client | Sends the facial expression prompt string |
| `submit_frame` | Client → Server | Player submits a base64 webcam frame |
| `score_result` | Server → Client | Returns mock AI score for the player's frame |
| `game_over` | Server → Client | Declares the winner after both frames scored |
