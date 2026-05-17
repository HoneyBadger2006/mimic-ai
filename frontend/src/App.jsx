import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:3001`
  : window.location.origin

const socket = io(SOCKET_URL)

const PHASE = {
  JOINING:  'joining',
  WAITING:  'waiting',
  PROMPT:   'prompt',
  JUDGING:  'judging',
  RESULTS:  'results',
}

export default function App() {
  const [phase, setPhase]       = useState(PHASE.JOINING)
  const [roomId, setRoomId]     = useState('')
  const [prompt, setPrompt]     = useState('')
  const [countdown, setCountdown] = useState(null)
  const [winner, setWinner]     = useState('')
  const [isMe, setIsMe]         = useState(false)
  const [myScore, setMyScore]   = useState(null)
  const [oppScore, setOppScore] = useState(null)
  const [error, setError]       = useState('')
  const videoRef  = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    socket.on('game_start', () => { setError('') })

    socket.on('prompt_ready', ({ prompt: p, promptScoredBy, error }) => {
      setPrompt(p)
      setPhase(PHASE.PROMPT)
      startWebcam()
      if (promptScoredBy === 'fallback') {
        console.warn('[DEBUG] AI prompt generation failed, using fallback. Error:', error)
        setError(`⚠️ AI prompt failed — using fallback (${error ?? 'unknown error'})`)
      }
    })

    socket.on('countdown', ({ count }) => { setCountdown(count) })

    socket.on('take_photo', () => { captureAndSubmit() })

    socket.on('judging', () => {
      setPhase(PHASE.JUDGING)
      stopWebcam()
    })

    socket.on('game_over', ({ winner: winnerId, scores, scoredBy, error }) => {
      const me = socket.id
      const oppId = Object.keys(scores ?? {}).find(id => id !== me)
      setIsMe(winnerId === me)
      setWinner(winnerId === me ? 'win' : 'lose')
      setMyScore(scores?.[me] ?? null)
      setOppScore(scores?.[oppId] ?? null)
      setPhase(PHASE.RESULTS)
      if (scoredBy === 'random') {
        console.warn('[DEBUG] Bedrock scoring failed, random winner picked. Error:', error)
        setError(`⚠️ AI scoring failed — random winner (${error ?? 'unknown error'})`)
      } else {
        console.log('[DEBUG] AI scored successfully')
      }
    })

    socket.on('error',       ({ message }) => setError(message))
    socket.on('player_left', () => {
      setError('Opponent disconnected.')
      setPhase(PHASE.WAITING)
      stopWebcam()
    })

    return () => {
      socket.off('game_start'); socket.off('prompt_ready')
      socket.off('countdown');  socket.off('take_photo')
      socket.off('judging');    socket.off('game_over')
      socket.off('error');      socket.off('player_left')
    }
  }, [])

  async function startWebcam() {
    const stream = await navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .catch(console.error)
    if (!stream) return
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream
  }

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function captureAndSubmit() {
    const video  = videoRef.current
    const canvas = document.createElement('canvas')
    const w = video?.videoWidth  || 640
    const h = video?.videoHeight || 480
    canvas.width  = w
    canvas.height = h
    if (video && video.videoWidth) {
      canvas.getContext('2d').drawImage(video, 0, 0)
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const base64  = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    if (!base64) {
      setError('Camera capture failed — check permissions and try again.')
      return
    }
    socket.emit('submit_frame', { frame: base64 })
  }

  function handleJoin() {
    const id = roomId.trim()
    if (!id) return
    setError('')
    socket.emit('join_room', { roomId: id })
    setPhase(PHASE.WAITING)
  }

  function handlePlayAgain() {
    setPhase(PHASE.JOINING)
    setPrompt('')
    setCountdown(null)
    setWinner('')
    setMyScore(null)
    setOppScore(null)
    setError('')
  }

  const showWebcam = phase === PHASE.PROMPT || phase === PHASE.JUDGING

  return (
    <HudViewport>
      {/* Error banner */}
      {error && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 99, padding: '8px 20px',
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.5)',
          borderRadius: 4, color: '#fca5a5',
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 13, fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase',
        }}>{error}</div>
      )}

      {/* ── JOINING — lobby ─────────────────────────────────────────── */}
      {phase === PHASE.JOINING && (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 40, padding: '0 24px',
          background: 'radial-gradient(60% 50% at 50% 35%, rgba(34,211,238,0.10), transparent 70%)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <Wordmark />
            <Subtitle>AI · Face · Battle</Subtitle>
          </div>

          <StatusTag>Local · 1v1</StatusTag>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <input
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="ENTER ROOM ID"
              autoFocus
              style={{
                padding: '14px 24px',
                background: 'transparent',
                border: '2px solid rgba(34,211,238,0.45)',
                borderRadius: 8,
                color: '#fff',
                fontFamily: "'Rajdhani', sans-serif",
                fontSize: 18, fontWeight: 600,
                letterSpacing: '0.20em', textTransform: 'uppercase',
                textAlign: 'center', outline: 'none', width: 280,
              }}
            />
            <OutlineButton color="cyan" onClick={handleJoin}>Join Game</OutlineButton>
          </div>
        </div>
      )}

      {/* ── WAITING — holding for second player ─────────────────────── */}
      {phase === PHASE.WAITING && (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 28,
        }}>
          <PulsingDots />
          <Eyebrow color="cyan">Waiting for opponent</Eyebrow>
          <StatusTag>Room: {roomId}</StatusTag>
        </div>
      )}

      {/* ── PROMPT + JUDGING — two-column play surface ──────────────── */}
      {showWebcam && (
        <div style={{
          minHeight: '100vh',
          padding: '70px 64px 56px',
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 1fr) minmax(380px, 1fr)',
          gap: 64, alignItems: 'center',
        }}>
          {/* LEFT — webcam viewfinder */}
          <BracketFrame color="cyan" label="Your Scan" style={{ aspectRatio: '3 / 4', width: '100%' }}>
            {/* Live video */}
            <video
              ref={videoRef}
              autoPlay playsInline muted
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: phase === PHASE.PROMPT ? 'block' : 'none',
              }}
            />
            {/* Dark base (shown when video off) */}
            {phase === PHASE.JUDGING && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'radial-gradient(80% 70% at 50% 40%, rgba(34,211,238,0.07), transparent 70%), #050810',
              }} />
            )}
            {/* Scanlines */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)',
            }} />
            {/* REC dot */}
            {phase === PHASE.PROMPT && (
              <div style={{
                position: 'absolute', top: 42, right: 18,
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: "'Rajdhani', sans-serif",
                fontSize: 11, fontWeight: 600,
                color: '#fca5a5', letterSpacing: '0.20em', textTransform: 'uppercase',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.7)',
                  animation: 'mimic-blink 1.2s ease-in-out infinite',
                }} />
                Rec
              </div>
            )}
            {/* Scanning overlay */}
            {phase === PHASE.JUDGING && (
              <>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)',
                  boxShadow: '0 0 14px rgba(34,211,238,0.7)',
                  animation: 'mimic-scan 1.6s linear infinite',
                }} />
                <div style={{
                  position: 'absolute', bottom: 22, left: 0, right: 0,
                  textAlign: 'center', color: '#22d3ee',
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 13, fontWeight: 600,
                  letterSpacing: '0.30em', textTransform: 'uppercase',
                }}>Analyzing…</div>
              </>
            )}
          </BracketFrame>

          {/* RIGHT — HUD column */}
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 36, textAlign: 'center',
          }}>
            {phase === PHASE.PROMPT && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                  <Eyebrow color="cyan">Challenge</Eyebrow>
                  <PromptText>{prompt}</PromptText>
                </div>
                {countdown !== null
                  ? <CountdownRing seconds={countdown} />
                  : <Eyebrow color="cyan">Strike your pose</Eyebrow>
                }
              </>
            )}

            {phase === PHASE.JUDGING && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                  <Eyebrow color="cyan">Hold steady</Eyebrow>
                  <PromptText>{prompt}</PromptText>
                </div>
                <PulsingDots />
                <Eyebrow color="cyan">AI is grading your face</Eyebrow>
              </>
            )}
          </div>
        </div>
      )}

      {/* Countdown fullscreen overlay */}
      {phase === PHASE.PROMPT && countdown !== null && countdown <= 3 && (
        <div style={{
          position: 'fixed', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 50,
        }}>
          <CountdownRing seconds={countdown} large />
        </div>
      )}

      {/* ── RESULTS — verdict ───────────────────────────────────────── */}
      {phase === PHASE.RESULTS && (
        <div style={{
          minHeight: '100vh',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 40, padding: '0 32px',
          background: isMe
            ? 'radial-gradient(60% 50% at 50% 50%, rgba(34,211,238,0.18), transparent 70%)'
            : 'radial-gradient(60% 50% at 50% 50%, rgba(239,68,68,0.18), transparent 70%)',
        }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Eyebrow color={isMe ? 'cyan' : 'red'}>You</Eyebrow>
            <VerdictText outcome={winner}>{winner.toUpperCase()}</VerdictText>
          </div>

          <div style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
            <ScoreCard label="You" score={myScore} highlight={isMe} />
            <ScoreCard label="Opponent" score={oppScore} highlight={!isMe} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 360 }}>
            <OutlineButton color="cyan"    fullWidth onClick={handlePlayAgain}>Play Again</OutlineButton>
            <OutlineButton color="neutral" fullWidth onClick={() => { setPhase(PHASE.JOINING); setError('') }}>
              Return to Menu
            </OutlineButton>
          </div>
        </div>
      )}
    </HudViewport>
  )
}

// ── HUD primitives ────────────────────────────────────────────────────────────

function HudViewport({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#000', color: '#fff',
      fontFamily: "'Rajdhani', system-ui, sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      <ViewportCorners />
      {children}
    </div>
  )
}

function ViewportCorners() {
  const arm = { position: 'absolute', width: 28, height: 28, borderColor: 'rgba(255,255,255,0.15)', borderStyle: 'solid', pointerEvents: 'none' }
  return (
    <>
      <div style={{ ...arm, top: 22,    left: 22,  borderWidth: '2px 0 0 2px' }} />
      <div style={{ ...arm, top: 22,    right: 22, borderWidth: '2px 2px 0 0' }} />
      <div style={{ ...arm, bottom: 22, left: 22,  borderWidth: '0 0 2px 2px' }} />
      <div style={{ ...arm, bottom: 22, right: 22, borderWidth: '0 2px 2px 0' }} />
    </>
  )
}

function BracketFrame({ color = 'cyan', children, label, style }) {
  const stroke     = color === 'red' ? '#ef4444' : '#22d3ee'
  const labelColor = color === 'red' ? '#fca5a5' : '#67e8f9'
  const arm = { position: 'absolute', width: 28, height: 28, borderColor: stroke, borderStyle: 'solid', pointerEvents: 'none' }
  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(180deg, #05070d, #000)',
      border: '1px solid rgba(255,255,255,0.04)',
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{ ...arm, top: 0,    left: 0,    borderWidth: '2px 0 0 2px' }} />
      <div style={{ ...arm, top: 0,    right: 0,   borderWidth: '2px 2px 0 0' }} />
      <div style={{ ...arm, bottom: 0, left: 0,    borderWidth: '0 0 2px 2px' }} />
      <div style={{ ...arm, bottom: 0, right: 0,   borderWidth: '0 2px 2px 0' }} />
      {label && (
        <div style={{
          position: 'absolute', top: 14, left: 18, zIndex: 2,
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 11, fontWeight: 600,
          letterSpacing: '0.20em', textTransform: 'uppercase',
          color: labelColor, whiteSpace: 'nowrap',
        }}>{label}</div>
      )}
      {children}
    </div>
  )
}

function Wordmark() {
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900,
      fontSize: 'clamp(64px, 10vw, 120px)',
      letterSpacing: '0.06em', lineHeight: 0.95,
      textTransform: 'uppercase',
      backgroundImage: `
        repeating-linear-gradient(to bottom, rgba(255,255,255,0.95) 0px, rgba(255,255,255,0.95) 3px, transparent 3px, transparent 7px),
        linear-gradient(180deg, #a5f3fc 0%, #22d3ee 100%)
      `,
      WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
      filter: 'drop-shadow(0 0 24px rgba(34,211,238,0.35))',
    }}>MIMIC</div>
  )
}

function Subtitle({ children }) {
  return (
    <div style={{
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 14, fontWeight: 500,
      letterSpacing: '0.40em', textTransform: 'uppercase',
      color: 'rgba(34,211,238,0.50)', marginTop: 8,
    }}>{children}</div>
  )
}

function Eyebrow({ color = 'cyan', children }) {
  const colors = { cyan: '#22d3ee', red: '#ef4444', mute: 'rgba(255,255,255,0.45)' }
  return (
    <div style={{
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 13, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.30em',
      color: colors[color] ?? colors.cyan,
    }}>{children}</div>
  )
}

function PromptText({ children }) {
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900, fontSize: 'clamp(28px, 3.5vw, 52px)',
      lineHeight: 1.05, letterSpacing: '0.02em',
      textTransform: 'uppercase', color: '#fff',
      textShadow: '0 0 24px rgba(255,255,255,0.18)',
      textAlign: 'center',
    }}>{children}</div>
  )
}

function VerdictText({ outcome, children }) {
  const styles = {
    win:  { color: '#22d3ee', textShadow: '0 0 36px rgba(34,211,238,0.65), 0 0 8px rgba(34,211,238,0.45)' },
    lose: { color: '#ef4444', textShadow: '0 0 36px rgba(239,68,68,0.65),  0 0 8px rgba(239,68,68,0.45)'  },
    tie:  { color: 'rgba(255,255,255,0.85)', textShadow: '0 0 24px rgba(255,255,255,0.20)' },
  }
  return (
    <div style={{
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 900, fontSize: 'clamp(72px, 12vw, 104px)',
      letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.0,
      ...(styles[outcome] ?? styles.lose),
    }}>{children}</div>
  )
}

function CountdownRing({ seconds, large = false }) {
  const urgent = seconds <= 2
  const size   = large ? 220 : 140
  const fs     = large ? 110 : 72
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `3px solid ${urgent ? '#ef4444' : 'rgba(34,211,238,0.55)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: urgent ? '0 0 24px rgba(239,68,68,0.55)' : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>
      <div style={{
        fontFamily: "'Orbitron', sans-serif",
        fontWeight: 900, fontSize: fs, lineHeight: 1,
        color: urgent ? '#ef4444' : '#fff',
        transition: 'color 0.2s',
      }}>{seconds}</div>
    </div>
  )
}

function PulsingDots() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} style={{
          width: 10, height: 10, borderRadius: '50%',
          background: '#22d3ee', boxShadow: '0 0 12px rgba(34,211,238,0.7)',
          animation: `mimic-pulse-dot 1.2s ease-in-out ${i * 0.15}s infinite`,
          display: 'inline-block',
        }} />
      ))}
    </div>
  )
}

function StatusTag({ children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 14px',
      fontFamily: "'Rajdhani', sans-serif",
      fontSize: 11, fontWeight: 600,
      letterSpacing: '0.20em', textTransform: 'uppercase',
      color: '#67e8f9', border: '1px solid rgba(34,211,238,0.45)',
      borderRadius: 999, background: 'transparent', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 4, background: '#22d3ee', boxShadow: '0 0 8px rgba(34,211,238,0.7)' }} />
      {children}
    </span>
  )
}

function OutlineButton({ color = 'cyan', onClick, children, fullWidth = false }) {
  const palettes = {
    cyan:    { c: '#22d3ee', bg: 'rgba(34,211,238,0.10)', glow: '0 0 16px rgba(34,211,238,0.45)' },
    red:     { c: '#ef4444', bg: 'rgba(239,68,68,0.10)',  glow: '0 0 16px rgba(239,68,68,0.45)'  },
    neutral: { c: 'rgba(255,255,255,0.78)', bg: 'rgba(255,255,255,0.05)', glow: 'none' },
  }
  const p = palettes[color]
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '16px 32px',
        background: hover ? p.bg : 'transparent',
        border: `2px solid ${p.c}`,
        borderRadius: 8, color: p.c,
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 18, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.16em',
        cursor: 'pointer',
        boxShadow: hover ? p.glow : 'none',
        transition: 'background 0.15s, box-shadow 0.15s',
        width: fullWidth ? '100%' : 'auto',
        minWidth: fullWidth ? 'auto' : 240,
      }}>
      {children}
    </button>
  )
}

function ScoreCard({ label, score, highlight }) {
  const [filled, setFilled] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setFilled(score ?? 0), 120)
    return () => clearTimeout(t)
  }, [score])

  const accent = highlight ? '#22d3ee' : 'rgba(255,255,255,0.55)'
  const barColor = score >= 70 ? '#22d3ee' : score >= 40 ? '#facc15' : '#ef4444'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '22px 28px 18px',
      border: `2px solid ${highlight ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.12)'}`,
      borderRadius: 14,
      background: highlight ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)',
      minWidth: 148,
    }}>
      <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', fontFamily: "'Rajdhani', sans-serif" }}>
        {label}
      </span>

      <span style={{ fontSize: '3.8rem', fontWeight: 900, lineHeight: 1, color: accent, fontFamily: "'Orbitron', sans-serif", textShadow: highlight ? '0 0 24px rgba(34,211,238,0.45)' : 'none' }}>
        {score != null ? `${score}%` : '--'}
      </span>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{
          width: '100%', height: 6, borderRadius: 3,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${filled}%`,
            background: `linear-gradient(90deg, ${barColor}88, ${barColor})`,
            boxShadow: `0 0 8px ${barColor}88`,
            transition: 'width 0.9s cubic-bezier(0.22,1,0.36,1)',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', fontFamily: "'Rajdhani', sans-serif" }}>0</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase' }}>Accuracy</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', fontFamily: "'Rajdhani', sans-serif" }}>100</span>
        </div>
      </div>
    </div>
  )
}
