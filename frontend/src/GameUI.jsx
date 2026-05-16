import { useState, useEffect, useRef } from "react";

// ── Phase constants ────────────────────────────────────────────────────────────
const PHASE = {
  WAITING_TO_START: "waiting_to_start",
  PROMPT: "prompt",
  WAITING_FOR_OPPONENT: "waiting_for_opponent",
  RESULTS: "results",
};

// ── Placeholder defaults (swap for real props once sockets are wired) ──────────
const DEFAULT_PROMPT = "Make a dead face";
const COUNTDOWN_SECONDS = 5;
const DEFAULT_MY_SCORE = 82;
const DEFAULT_OPP_SCORE = 67;
const DEFAULT_MY_LABEL = "You";
const DEFAULT_OPP_LABEL = "Opponent";
const DEFAULT_WINNER = "You"; // "You" | "Opponent" | "Tie"

/**
 * GameUI — full game flow for Mimic-AI.
 *
 * Props (all optional while using placeholder data):
 *   prompt          {string}   The facial expression prompt
 *   countdownSecs   {number}   Seconds to count down before auto-submit (default 5)
 *   myScore         {number}   This player's final score (0-100)
 *   oppScore        {number}   Opponent's final score (0-100)
 *   myLabel         {string}   Display name for this player
 *   oppLabel        {string}   Display name for opponent
 *   winner          {string}   "You" | "Opponent" | "Tie"
 *   onSubmit        {fn}       Called when the player submits (for emit submit_frame)
 *   phase           {string}   Controlled phase override (optional)
 *   onJoinRoom      {fn}       Called when "Join Game" is clicked (emit join_room)
 */
export default function GameUI({
  prompt = DEFAULT_PROMPT,
  countdownSecs = COUNTDOWN_SECONDS,
  myScore = DEFAULT_MY_SCORE,
  oppScore = DEFAULT_OPP_SCORE,
  myLabel = DEFAULT_MY_LABEL,
  oppLabel = DEFAULT_OPP_LABEL,
  winner = DEFAULT_WINNER,
  onSubmit,
  phase: controlledPhase,
  onJoinRoom,
}) {
  const [phase, setPhase] = useState(controlledPhase ?? PHASE.WAITING_TO_START);
  const [timeLeft, setTimeLeft] = useState(countdownSecs);
  const timerRef = useRef(null);

  // Sync if parent drives phase via socket events
  useEffect(() => {
    if (controlledPhase) setPhase(controlledPhase);
  }, [controlledPhase]);

  // Countdown tick — runs only during PROMPT phase
  useEffect(() => {
    if (phase !== PHASE.PROMPT) return;

    setTimeLeft(countdownSecs);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          handleSubmit(); // auto-submit when time runs out
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleSubmit() {
    clearInterval(timerRef.current);
    onSubmit?.();
    if (!controlledPhase) setPhase(PHASE.WAITING_FOR_OPPONENT);
  }

  function handleJoinGame() {
    onJoinRoom?.();
    if (!controlledPhase) setPhase(PHASE.PROMPT);
  }

  // ── Demo cycling button (remove once sockets drive phase) ─────────────────
  function cyclePhase() {
    const order = [
      PHASE.WAITING_TO_START,
      PHASE.PROMPT,
      PHASE.WAITING_FOR_OPPONENT,
      PHASE.RESULTS,
    ];
    setPhase((p) => {
      const next = order[(order.indexOf(p) + 1) % order.length];
      if (next === PHASE.PROMPT) setTimeLeft(countdownSecs);
      return next;
    });
  }

  const isUrgent = timeLeft <= 2;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* ── WAITING TO START ── */}
      {phase === PHASE.WAITING_TO_START && (
        <div style={styles.card}>
          <h1 style={styles.title}>Mimic-AI</h1>
          <p style={styles.subtitle}>Waiting for a match…</p>
          <button style={styles.btn} onClick={handleJoinGame}>
            Join Game
          </button>
        </div>
      )}

      {/* ── PROMPT + COUNTDOWN ── */}
      {phase === PHASE.PROMPT && (
        <div style={styles.card}>
          <p style={styles.label}>Your challenge:</p>
          <h1 style={styles.promptText}>{prompt}</h1>

          <div style={{ ...styles.countdown, ...(isUrgent ? styles.countdownUrgent : {}) }}>
            {timeLeft}
          </div>

          <button style={styles.btn} onClick={handleSubmit}>
            Submit
          </button>
        </div>
      )}

      {/* ── WAITING FOR OPPONENT ── */}
      {phase === PHASE.WAITING_FOR_OPPONENT && (
        <div style={styles.card}>
          <div style={styles.spinner} />
          <h2 style={styles.waitingText}>Waiting for opponent…</h2>
        </div>
      )}

      {/* ── RESULTS ── */}
      {phase === PHASE.RESULTS && (
        <div style={styles.card}>
          <h2 style={styles.winnerBanner}>
            {winner === "Tie"
              ? "It's a Tie!"
              : `${winner} wins!`}
          </h2>

          <div style={styles.scoresRow}>
            <ScoreCard
              label={myLabel}
              score={myScore}
              highlight={winner === myLabel || winner === "You"}
            />
            <div style={styles.vs}>VS</div>
            <ScoreCard
              label={oppLabel}
              score={oppScore}
              highlight={winner === oppLabel || winner === "Opponent"}
            />
          </div>

          <button style={styles.btn} onClick={handleJoinGame}>
            Play Again
          </button>
        </div>
      )}

      {/* ── Dev helper: cycle through phases ── */}
      {!controlledPhase && (
        <button style={styles.devBtn} onClick={cyclePhase}>
          [dev] next phase →
        </button>
      )}
    </div>
  );
}

function ScoreCard({ label, score, highlight }) {
  return (
    <div style={{ ...styles.scoreCard, ...(highlight ? styles.scoreCardWinner : {}) }}>
      <p style={styles.scoreLabel}>{label}</p>
      <p style={styles.scoreValue}>{score}</p>
      <p style={styles.scoreUnit}>pts</p>
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
    fontFamily: "'Segoe UI', sans-serif",
    color: "#fff",
    padding: "1rem",
  },
  card: {
    background: "rgba(255,255,255,0.07)",
    backdropFilter: "blur(12px)",
    borderRadius: "1.5rem",
    padding: "3rem 2.5rem",
    textAlign: "center",
    maxWidth: 520,
    width: "100%",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.5rem",
  },
  title: {
    fontSize: "3rem",
    fontWeight: 800,
    margin: 0,
    letterSpacing: "-1px",
  },
  subtitle: {
    fontSize: "1.2rem",
    color: "rgba(255,255,255,0.65)",
    margin: 0,
  },
  label: {
    fontSize: "1rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "rgba(255,255,255,0.5)",
    margin: 0,
  },
  promptText: {
    fontSize: "clamp(2rem, 5vw, 3.2rem)",
    fontWeight: 900,
    lineHeight: 1.1,
    margin: 0,
    color: "#f9e04b",
    textShadow: "0 0 20px rgba(249,224,75,0.5)",
  },
  countdown: {
    fontSize: "6rem",
    fontWeight: 900,
    lineHeight: 1,
    transition: "color 0.3s, transform 0.3s",
    color: "#fff",
  },
  countdownUrgent: {
    color: "#ff4d4d",
    transform: "scale(1.15)",
    textShadow: "0 0 24px rgba(255,77,77,0.7)",
  },
  btn: {
    padding: "0.85rem 2.5rem",
    fontSize: "1.1rem",
    fontWeight: 700,
    borderRadius: "999px",
    border: "none",
    background: "linear-gradient(90deg, #f9e04b, #f7971e)",
    color: "#111",
    cursor: "pointer",
    letterSpacing: "0.04em",
    boxShadow: "0 4px 18px rgba(249,224,75,0.35)",
    transition: "transform 0.15s, box-shadow 0.15s",
  },
  spinner: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    border: "6px solid rgba(255,255,255,0.15)",
    borderTopColor: "#f9e04b",
    animation: "spin 0.9s linear infinite",
  },
  waitingText: {
    fontSize: "1.6rem",
    fontWeight: 700,
    margin: 0,
    color: "rgba(255,255,255,0.8)",
  },
  winnerBanner: {
    fontSize: "2.2rem",
    fontWeight: 900,
    margin: 0,
    color: "#f9e04b",
    textShadow: "0 0 20px rgba(249,224,75,0.5)",
  },
  scoresRow: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    width: "100%",
    justifyContent: "center",
  },
  vs: {
    fontSize: "1.4rem",
    fontWeight: 900,
    color: "rgba(255,255,255,0.4)",
  },
  scoreCard: {
    flex: 1,
    background: "rgba(255,255,255,0.08)",
    borderRadius: "1rem",
    padding: "1.25rem",
    border: "2px solid transparent",
    transition: "border 0.2s",
  },
  scoreCardWinner: {
    border: "2px solid #f9e04b",
    boxShadow: "0 0 18px rgba(249,224,75,0.3)",
  },
  scoreLabel: {
    margin: "0 0 0.25rem",
    fontSize: "0.9rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.55)",
  },
  scoreValue: {
    margin: 0,
    fontSize: "3.5rem",
    fontWeight: 900,
    lineHeight: 1,
    color: "#fff",
  },
  scoreUnit: {
    margin: "0.25rem 0 0",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.4)",
  },
  devBtn: {
    marginTop: "1.5rem",
    padding: "0.4rem 1rem",
    fontSize: "0.75rem",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "transparent",
    color: "rgba(255,255,255,0.4)",
    cursor: "pointer",
  },
};

// inject keyframe for spinner
const styleTag = document.createElement("style");
styleTag.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleTag);
