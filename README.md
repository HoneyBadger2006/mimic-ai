# Mimic AI 🎭

Ever wondered who can pull off the most dramatic face? Mimic AI is a real-time 1v1 face battle game where two players go head-to-head to see who can best nail a given expression — and an AI judge decides the winner.

## How It Works

1. Two players open the game and join the same room using a shared room ID
2. A random challenge appears — something like *"Show pure happiness! 😄"* or *"Look totally terrified! 😱"*
3. Both players strike their best face before the countdown hits zero
4. The AI scans both photos and scores each player on how well they nailed the expression
5. The winner is announced, along with scores, photos, and a personalised tip to do better next time

## Features

- Real-time multiplayer — works over the internet, not just local Wi-Fi
- AI-powered judging using Claude (no random scores)
- A wide variety of emotional challenges that change every round
- Works on both desktop and mobile
- Victory music for the winner 🎵
- Play Again sends you straight into a rematch with the same opponent

## Getting Started

You'll need [Node.js](https://nodejs.org) installed.

### 1. Start the backend
```bash
cd backend
npm install
npm run dev
```

### 2. Start the frontend
```bash
cd frontend
npm install
npm run dev
```

Then open the local URL shown in your terminal. Share it with a friend, pick the same room ID, and battle it out!
