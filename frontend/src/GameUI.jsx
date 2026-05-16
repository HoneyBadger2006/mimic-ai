import { useState, useEffect, useRef } from "react";

// ── Phase constants ────────────────────────────────────────────────────────────
const PHASE = {
  MENU:     "menu",
  PLAY:     "play",       // prompt + countdown + submit
  SCANNING: "scanning",   // waiting for opponent / AI verdict
  VERDICT:  "verdict",
};

const PROMPTS = [
  "Make a dead face",
  "Best surprised face",
  "Pure rage",
  "Try not to smile",
  "Maximum cringe",
];

const OUTCOMES = [
  { o: "win",  word: "WIN",  eyebrow: "You" },
  { o: "lose", word: "LOSE", eyebrow: "You" },
  { o: "tie",  word: "TIE",  eyebrow: "It's a" },
];

/**
 * GameUI — Mimic-AI v2 arcade HUD.
 *
 * Props (all optional while using placeholder data):
 *   prompt        {string}              from socket prompt_ready
 *   outcome       {"win"|"lose"|"tie"}  from socket game_over
 *   onSubmit      {fn}                  emits submit_frame
 *   onJoinRoom    {fn}                  emits join_room
 *   phase         {string}              controlled phase from socket events
 */
export default function GameUI({
  prompt: promptProp,
  outcome: outcomeProp,
  onSubmit,
  onJoinRoom,
  phase: controlledPhase,
}) {
  const [phase, setPhase]       = useState(controlledPhase ?? PHASE.MENU);
  const [round, setRound]       = useState(0);
  const [timeLeft, setTimeLeft] = useState(5);
  const [outcomeIdx, setOutcomeIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (controlledPhase) setPhase(controlledPhase);
  }, [controlledPhase]);

  // Countdown during PLAY phase
  useEffect(() => {
    if (phase !== PHASE.PLAY) return;
    setTimeLeft(5);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  function startMatch() {
    setRound((r) => r + 1);
    if (!controlledPhase) setPhase(PHASE.PLAY);
    onJoinRoom?.();
  }

  function handleSubmit() {
    clearInterval(timerRef.current);
    onSubmit?.();
    if (!controlledPhase) {
      setPhase(PHASE.SCANNING);
      // simulate AI grading delay in demo mode
      setTimeout(() => {
        setOutcomeIdx(Math.floor(Math.random() * OUTCOMES.length));
        setPhase(PHASE.VERDICT);
      }, 2200);
    }
  }

  function handleRematch() {
    setRound((r) => r + 1);
    if (!controlledPhase) setPhase(PHASE.PLAY);
    onJoinRoom?.();
  }

  function handleMenu() {
    if (!controlledPhase) setPhase(PHASE.MENU);
  }

  const activePrompt  = promptProp  ?? PROMPTS[round % PROMPTS.length];
  const activeOutcome = outcomeProp
    ? OUTCOMES.find((x) => x.o === outcomeProp) ?? OUTCOMES[0]
    : OUTCOMES[outcomeIdx];

  // dev cycle helper
  function cyclePhase() {
    const order = [PHASE.MENU, PHASE.PLAY, PHASE.SCANNING, PHASE.VERDICT];
    setPhase((p) => {
      const next = order[(order.indexOf(p) + 1) % order.length];
      if (next === PHASE.PLAY)    setRound((r) => r + 1);
      if (next === PHASE.VERDICT) setOutcomeIdx(Math.floor(Math.random() * OUTCOMES.length));
      return next;
    });
  }

  return (
    <HudViewport>
      {phase === PHASE.MENU     && <MenuScreen    onStart={startMatch} />}
      {phase === PHASE.PLAY     && <PlayScreen    prompt={activePrompt} seconds={timeLeft} onSubmit={handleSubmit} />}
      {phase === PHASE.SCANNING && <PlayScreen    prompt={activePrompt} seconds={0} onSubmit={() => {}} scanning />}
      {phase === PHASE.VERDICT  && <VerdictScreen outcome={activeOutcome} onRematch={handleRematch} onMenu={handleMenu} />}

      {!controlledPhase && <DevJump onCycle={cyclePhase} />}
    </HudViewport>
  );
}

// ── Layout: full-viewport HUD chassis with corner brackets ────────────────────
function HudViewport({ children }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
      color: "#fff",
      fontFamily: "'Rajdhani', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      <ViewportCorners />
      {children}
    </div>
  );
}

function ViewportCorners() {
  const arm = { position: "absolute", width: 28, height: 28, borderColor: "rgba(255,255,255,0.15)", borderStyle: "solid", pointerEvents: "none" };
  return (
    <>
      <div style={{ ...arm, top: 22,    left: 22,  borderWidth: "2px 0 0 2px" }} />
      <div style={{ ...arm, top: 22,    right: 22, borderWidth: "2px 2px 0 0" }} />
      <div style={{ ...arm, bottom: 22, left: 22,  borderWidth: "0 0 2px 2px" }} />
      <div style={{ ...arm, bottom: 22, right: 22, borderWidth: "0 2px 2px 0" }} />
    </>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────

function MenuScreen({ onStart }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 40, padding: "0 24px",
      background: "radial-gradient(60% 50% at 50% 35%, rgba(34,211,238,0.10), transparent 70%)",
    }}>
      <div style={{ textAlign: "center" }}>
        <Wordmark />
        <Subtitle>AI · Face · Battle</Subtitle>
      </div>
      <StatusTag>Local · 1v1</StatusTag>
      <OutlineButton color="cyan" onClick={onStart}>Start Demo</OutlineButton>
    </div>
  );
}

function PlayScreen({ prompt, seconds, onSubmit, scanning = false }) {
  return (
    <div style={{
      minHeight: "100vh",
      padding: "70px 64px 56px",
      display: "grid",
      gridTemplateColumns: "minmax(300px, 1fr) minmax(380px, 1fr)",
      gap: 64,
      alignItems: "center",
    }}>
      {/* LEFT — webcam viewfinder */}
      <WebcamPanel scanning={scanning} />

      {/* RIGHT — HUD column */}
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 36, textAlign: "center",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
          <Eyebrow color="cyan">{scanning ? "Hold steady" : "Challenge"}</Eyebrow>
          <PromptText>{prompt}</PromptText>
        </div>

        {scanning ? (
          <ScanningBlock />
        ) : (
          <>
            <CountdownRing seconds={seconds} />
            <OutlineButton color="cyan" onClick={onSubmit}>Submit Scan</OutlineButton>
          </>
        )}
      </div>
    </div>
  );
}

function VerdictScreen({ outcome, onRematch, onMenu }) {
  const blooms = {
    win:  "radial-gradient(60% 50% at 50% 50%, rgba(34,211,238,0.18), transparent 70%)",
    lose: "radial-gradient(60% 50% at 50% 50%, rgba(239,68,68,0.18),  transparent 70%)",
    tie:  "radial-gradient(60% 50% at 50% 50%, rgba(255,255,255,0.05), transparent 70%)",
  };
  const eyebrowColor = { win: "cyan", lose: "red", tie: "mute" }[outcome.o];

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 40, padding: "0 32px",
      background: blooms[outcome.o],
    }}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
        <Eyebrow color={eyebrowColor}>{outcome.eyebrow}</Eyebrow>
        <VerdictText outcome={outcome.o}>{outcome.word}</VerdictText>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 360 }}>
        <OutlineButton color="cyan"    fullWidth onClick={onRematch}>Rematch</OutlineButton>
        <OutlineButton color="neutral" fullWidth onClick={onMenu}>Return to Menu</OutlineButton>
      </div>
    </div>
  );
}

// ── Primitive components ───────────────────────────────────────────────────────

function Wordmark() {
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900,
      fontSize: "clamp(64px, 10vw, 120px)",
      letterSpacing: "0.06em",
      lineHeight: 0.95,
      textTransform: "uppercase",
      backgroundImage: `
        repeating-linear-gradient(to bottom, rgba(255,255,255,0.95) 0px, rgba(255,255,255,0.95) 3px, transparent 3px, transparent 7px),
        linear-gradient(180deg, #a5f3fc 0%, #22d3ee 100%)
      `,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      filter: "drop-shadow(0 0 24px rgba(34,211,238,0.35))",
    }}>MIMIC</div>
  );
}

function Subtitle({ children }) {
  return (
    <div style={{
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 14, fontWeight: 500,
      letterSpacing: "0.40em",
      textTransform: "uppercase",
      color: "rgba(34,211,238,0.50)",
      marginTop: 8,
    }}>{children}</div>
  );
}

function Eyebrow({ color = "cyan", children }) {
  const colors = { cyan: "#22d3ee", red: "#ef4444", mute: "rgba(255,255,255,0.45)" };
  return (
    <div style={{
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 13, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.30em",
      color: colors[color] ?? colors.cyan,
    }}>{children}</div>
  );
}

function PromptText({ children }) {
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900,
      fontSize: "clamp(32px, 4vw, 56px)",
      lineHeight: 1.0,
      letterSpacing: "0.02em",
      textTransform: "uppercase",
      color: "#fff",
      textShadow: "0 0 24px rgba(255,255,255,0.18)",
      textAlign: "center",
    }}>{children}</div>
  );
}

function VerdictText({ outcome, children }) {
  const styles = {
    win:  { color: "#22d3ee", textShadow: "0 0 36px rgba(34,211,238,0.65), 0 0 8px rgba(34,211,238,0.45)" },
    lose: { color: "#ef4444", textShadow: "0 0 36px rgba(239,68,68,0.65),  0 0 8px rgba(239,68,68,0.45)"  },
    tie:  { color: "rgba(255,255,255,0.85)", textShadow: "0 0 24px rgba(255,255,255,0.20)" },
  };
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900,
      fontSize: "clamp(72px, 12vw, 104px)",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      lineHeight: 1.0,
      ...styles[outcome],
    }}>{children}</div>
  );
}

function CountdownRing({ seconds }) {
  const urgent = seconds <= 2;
  return (
    <div style={{
      width: 140, height: 140,
      borderRadius: "50%",
      border: `3px solid ${urgent ? "#ef4444" : "rgba(34,211,238,0.55)"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: urgent ? "0 0 24px rgba(239,68,68,0.55)" : "none",
      transition: "border-color 0.2s, box-shadow 0.2s",
    }}>
      <div style={{
        fontFamily: "'Orbitron', sans-serif",
        fontWeight: 900, fontSize: 72, lineHeight: 1,
        color: urgent ? "#ef4444" : "#fff",
        transition: "color 0.2s",
      }}>{seconds}</div>
    </div>
  );
}

function WebcamPanel({ scanning }) {
  return (
    <BracketFrame color="cyan" label="Your Scan" style={{ aspectRatio: "3 / 4", width: "100%" }}>
      {/* Faux feed — dark with cyan tint */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(80% 70% at 50% 40%, rgba(34,211,238,0.07), transparent 70%), #050810",
      }} />
      {/* Scanlines */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
      }} />
      {/* Face target guide */}
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%, -50%)",
        width: "55%", aspectRatio: "1 / 1.2",
        border: "1px dashed rgba(34,211,238,0.35)", borderRadius: 6,
      }} />
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%, -50%) translateY(110px)",
        fontSize: 11, color: "rgba(34,211,238,0.65)",
        letterSpacing: "0.30em", textTransform: "uppercase",
        whiteSpace: "nowrap",
        fontFamily: "'Rajdhani', sans-serif",
      }}>Position face</div>
      {/* REC dot */}
      <div style={{
        position: "absolute", top: 42, right: 18,
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 11, fontWeight: 600,
        color: "#fca5a5", letterSpacing: "0.20em", textTransform: "uppercase",
        fontFamily: "'Rajdhani', sans-serif",
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 4,
          background: "#ef4444", boxShadow: "0 0 8px rgba(239,68,68,0.7)",
          animation: "mimic-blink 1.2s ease-in-out infinite",
        }} />
        Rec
      </div>
      {/* Scanning overlay */}
      {scanning && (
        <>
          <div style={{
            position: "absolute", left: 0, right: 0, height: 2,
            background: "linear-gradient(90deg, transparent, #22d3ee, transparent)",
            boxShadow: "0 0 14px rgba(34,211,238,0.7)",
            animation: "mimic-scan 1.6s linear infinite",
          }} />
          <div style={{
            position: "absolute", bottom: 22, left: 0, right: 0,
            textAlign: "center", color: "#22d3ee",
            fontSize: 13, fontWeight: 600,
            letterSpacing: "0.30em", textTransform: "uppercase",
            fontFamily: "'Rajdhani', sans-serif",
          }}>Analyzing…</div>
        </>
      )}
    </BracketFrame>
  );
}

function ScanningBlock() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "#22d3ee",
            boxShadow: "0 0 12px rgba(34,211,238,0.7)",
            animation: `mimic-pulse-dot 1.2s ease-in-out ${i * 0.15}s infinite`,
            display: "inline-block",
          }} />
        ))}
      </div>
      <Eyebrow color="cyan">AI is grading your face</Eyebrow>
    </div>
  );
}

function BracketFrame({ color = "cyan", children, label, style }) {
  const stroke = color === "red" ? "#ef4444" : "#22d3ee";
  const labelColor = color === "red" ? "#fca5a5" : "#67e8f9";
  const arm = { position: "absolute", width: 28, height: 28, borderColor: stroke, borderStyle: "solid", pointerEvents: "none" };
  return (
    <div style={{
      position: "relative",
      background: "linear-gradient(180deg, #05070d, #000)",
      border: "1px solid rgba(255,255,255,0.04)",
      ...style,
    }}>
      <div style={{ ...arm, top: 0,    left: 0,    borderWidth: "2px 0 0 2px" }} />
      <div style={{ ...arm, top: 0,    right: 0,   borderWidth: "2px 2px 0 0" }} />
      <div style={{ ...arm, bottom: 0, left: 0,    borderWidth: "0 0 2px 2px" }} />
      <div style={{ ...arm, bottom: 0, right: 0,   borderWidth: "0 2px 2px 0" }} />
      {label && (
        <div style={{
          position: "absolute", top: 14, left: 18, zIndex: 2,
          fontSize: 11, fontWeight: 600,
          letterSpacing: "0.20em", textTransform: "uppercase",
          color: labelColor, whiteSpace: "nowrap",
          fontFamily: "'Rajdhani', sans-serif",
        }}>{label}</div>
      )}
      {children}
    </div>
  );
}

function StatusTag({ color = "cyan", children }) {
  const c      = color === "red" ? "#fca5a5" : "#67e8f9";
  const dot    = color === "red" ? "#ef4444" : "#22d3ee";
  const border = color === "red" ? "rgba(239,68,68,0.45)" : "rgba(34,211,238,0.45)";
  const glow   = color === "red" ? "0 0 8px rgba(239,68,68,0.7)" : "0 0 8px rgba(34,211,238,0.7)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 14px",
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 11, fontWeight: 600,
      letterSpacing: "0.20em", textTransform: "uppercase",
      color: c, border: `1px solid ${border}`,
      borderRadius: 999, background: "transparent",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 4, background: dot, boxShadow: glow }} />
      {children}
    </span>
  );
}

function OutlineButton({ color = "cyan", onClick, children, fullWidth = false, style }) {
  const palettes = {
    cyan:    { c: "#22d3ee", bg: "rgba(34,211,238,0.10)", glow: "0 0 16px rgba(34,211,238,0.45)" },
    red:     { c: "#ef4444", bg: "rgba(239,68,68,0.10)",  glow: "0 0 16px rgba(239,68,68,0.45)"  },
    neutral: { c: "rgba(255,255,255,0.78)", bg: "rgba(255,255,255,0.05)", glow: "none" },
  };
  const p = palettes[color];
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "16px 32px",
        background: hover ? p.bg : "transparent",
        border: `2px solid ${p.c}`,
        borderRadius: 8,
        color: p.c,
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 18, fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        cursor: "pointer",
        boxShadow: hover ? p.glow : "none",
        transition: "background 0.15s, box-shadow 0.15s",
        width: fullWidth ? "100%" : "auto",
        minWidth: fullWidth ? "auto" : 240,
        ...style,
      }}>
      {children}
    </button>
  );
}

function DevJump({ onCycle }) {
  return (
    <button onClick={onCycle} style={{
      position: "fixed", bottom: 18, right: 60,
      padding: "8px 14px",
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 11, fontWeight: 600,
      letterSpacing: "0.16em", textTransform: "uppercase",
      background: "transparent",
      color: "rgba(255,255,255,0.35)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 4, cursor: "pointer", zIndex: 10,
      whiteSpace: "nowrap",
    }}>[dev] next phase →</button>
  );
}
