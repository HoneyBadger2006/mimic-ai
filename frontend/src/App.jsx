import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { io } from 'socket.io-client'

const MobileCtx = createContext(false)
function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 700)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 700)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin
const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] })

const PHASE = {
  JOINING:  'joining',
  WAITING:  'waiting',
  PROMPT:   'prompt',
  JUDGING:  'judging',
  RESULTS:  'results',
}

export default function App() {
  const isMobile = useIsMobile()
  const [phase, setPhase]       = useState(PHASE.JOINING)
  const [roomId, setRoomId]     = useState('')
  const [prompt, setPrompt]     = useState('')
  const [countdown, setCountdown] = useState(null)
  const [winner, setWinner]     = useState('')
  const [isMe, setIsMe]         = useState(false)
  const [myScore, setMyScore]   = useState(null)
  const [oppScore, setOppScore] = useState(null)
  const [error, setError]       = useState('')
  const [myPhoto, setMyPhoto]   = useState(null)
  const [oppPhoto, setOppPhoto] = useState(null)
  const [tip, setTip]           = useState(null)
  const videoRef        = useRef(null)
  const streamRef       = useRef(null)
  const winAudioRef     = useRef(null)
  const rematchTimerRef = useRef(null)

  useEffect(() => {
    socket.on('game_start', () => {
      setError('')
      clearTimeout(rematchTimerRef.current)
    })

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

    socket.on('game_over', ({ winner: winnerId, yourScore, oppScore, oppPhoto: oppPhotoData, tip: tipData, scoredBy, error }) => {
      const won = winnerId === socket.id
      setIsMe(won)
      setWinner(won ? 'win' : 'lose')
      setMyScore(yourScore ?? null)
      setOppScore(oppScore ?? null)
      setOppPhoto(oppPhotoData ?? null)
      setTip(tipData ?? null)
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

  // Create audio once on mount and unlock it on first user tap (required by iOS)
  useEffect(() => {
    const audio = new Audio('/win.mp3')
    audio.preload = 'auto'
    winAudioRef.current = audio

    const unlock = () => {
      audio.volume = 0
      audio.play()
        .then(() => { audio.pause(); audio.currentTime = 0; audio.volume = 1 })
        .catch(() => {})
    }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click',      unlock, { once: true })

    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('click',      unlock)
      audio.pause()
    }
  }, [])

  // Play win sound and fade after 10s — reuses the already-unlocked audio element
  useEffect(() => {
    const audio = winAudioRef.current
    if (!audio) return

    if (phase !== PHASE.RESULTS || !isMe) {
      audio.pause()
      audio.currentTime = 0
      return
    }

    audio.currentTime = 7
    audio.volume = 1
    audio.play().catch(() => {})

    let fadeInterval = null
    const fadeStart = setTimeout(() => {
      fadeInterval = setInterval(() => {
        if (audio.volume > 0.05) {
          audio.volume = Math.max(0, audio.volume - 0.05)
        } else {
          audio.volume = 0
          audio.pause()
          clearInterval(fadeInterval)
        }
      }, 100)
    }, 10000)

    return () => {
      clearTimeout(fadeStart)
      if (fadeInterval) clearInterval(fadeInterval)
      audio.pause()
      audio.currentTime = 0
    }
  }, [phase, isMe])

  async function startWebcam() {
    const stream = await navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      .catch(console.error)
    if (!stream) return
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => {})
    }
  }

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  async function captureAndSubmit() {
    const video = videoRef.current

    // Wait up to 3s for the video to have a live frame (critical on mobile)
    if (video && video.readyState < 2) {
      await new Promise(resolve => {
        const done = () => { video.removeEventListener('canplay', done); resolve() }
        video.addEventListener('canplay', done)
        setTimeout(resolve, 3000)
      })
    }

    const canvas = document.createElement('canvas')
    const w = (video?.videoWidth  > 0 ? video.videoWidth  : 640)
    const h = (video?.videoHeight > 0 ? video.videoHeight : 480)
    canvas.width  = w
    canvas.height = h

    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      canvas.getContext('2d').drawImage(video, 0, 0)
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setMyPhoto(dataUrl)
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    socket.emit('submit_frame', { frame: base64 || null })
  }

  function handleJoin() {
    const id = roomId.trim()
    if (!id) return
    setError('')
    socket.emit('join_room', { roomId: id })
    setPhase(PHASE.WAITING)
  }

  function handlePlayAgain() {
    setPrompt('')
    setCountdown(null)
    setWinner('')
    setMyScore(null)
    setOppScore(null)
    setMyPhoto(null)
    setOppPhoto(null)
    setTip(null)
    setError('')
    socket.emit('join_room', { roomId })
    setPhase(PHASE.WAITING)

    rematchTimerRef.current = setTimeout(() => {
      setPhase(PHASE.JOINING)
      setError('Opponent did not rematch. Returning to menu…')
    }, 20000)
  }

  const showWebcam = phase === PHASE.PROMPT || phase === PHASE.JUDGING

  return (
    <MobileCtx.Provider value={isMobile}>
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
                textAlign: 'center', outline: 'none', width: 'min(280px, 85vw)',
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

      {/* ── PROMPT + JUDGING — play surface ─────────────────────────── */}
      {showWebcam && (
        <div style={{
          minHeight: '100vh',
          padding: isMobile ? '20px 16px 24px' : '70px 64px 56px',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(300px, 1fr) minmax(380px, 1fr)',
          gap: isMobile ? 20 : 64, alignItems: 'center',
        }}>
          {/* LEFT — webcam viewfinder */}
          <BracketFrame color="cyan" label="Your Scan" style={{ aspectRatio: isMobile ? '4 / 3' : '3 / 4', width: '100%' }}>
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
            alignItems: 'center', gap: isMobile ? 16 : 36, textAlign: 'center',
          }}>
            {phase === PHASE.PROMPT && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                  <Eyebrow color="cyan">Challenge</Eyebrow>
                  <PromptText>{prompt}</PromptText>
                </div>
                {countdown === null && <Eyebrow color="cyan">Strike your pose</Eyebrow>}
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
          gap: isMobile ? 20 : 40, padding: isMobile ? '32px 16px' : '0 32px',
          background: isMe
            ? 'radial-gradient(60% 50% at 50% 50%, rgba(34,211,238,0.18), transparent 70%)'
            : 'radial-gradient(60% 50% at 50% 50%, rgba(239,68,68,0.18), transparent 70%)',
        }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Eyebrow color={isMe ? 'cyan' : 'red'}>You</Eyebrow>
            <VerdictText outcome={winner}>{winner.toUpperCase()}</VerdictText>
          </div>

          <div style={{ display: 'flex', gap: isMobile ? 12 : 24, justifyContent: 'center', width: '100%' }}>
            <ScoreCard label="You" score={myScore} winner={isMe} />
            <ScoreCard label="Opponent" score={oppScore} winner={!isMe} />
          </div>

          {/* Prompt used */}
          {prompt && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontFamily: "'Rajdhani', sans-serif", marginBottom: 6 }}>Challenge</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.06em' }}>{prompt}</div>
            </div>
          )}

          {/* Side-by-side photos */}
          {(myPhoto || oppPhoto) && (
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'flex-start' }}>
              {myPhoto && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.20em', textTransform: 'uppercase', color: isMe ? '#22d3ee' : 'rgba(255,255,255,0.35)', fontFamily: "'Rajdhani', sans-serif" }}>You</div>
                  <img src={myPhoto} alt="Your face" style={{ width: isMobile ? 130 : 180, borderRadius: 10, border: `2px solid ${isMe ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.15)'}`, transform: 'scaleX(-1)' }} />
                </div>
              )}
              {oppPhoto && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.20em', textTransform: 'uppercase', color: !isMe ? '#22d3ee' : 'rgba(255,255,255,0.35)', fontFamily: "'Rajdhani', sans-serif" }}>Opponent</div>
                  <img src={oppPhoto} alt="Opponent face" style={{ width: isMobile ? 130 : 180, borderRadius: 10, border: `2px solid ${!isMe ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.15)'}`, transform: 'scaleX(-1)' }} />
                </div>
              )}
            </div>
          )}

          {/* AI tip */}
          {tip && (
            <div style={{
              maxWidth: isMobile ? '100%' : 420, padding: '16px 22px',
              border: '1px solid rgba(250,204,21,0.35)',
              borderRadius: 10,
              background: 'rgba(250,204,21,0.06)',
              display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#facc15', fontFamily: "'Rajdhani', sans-serif" }}>AI Tip — How to Improve</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.04em', lineHeight: 1.5 }}>{tip}</div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: isMobile ? '100%' : 360 }}>
            <OutlineButton color="cyan"    fullWidth onClick={handlePlayAgain}>Play Again</OutlineButton>
            <OutlineButton color="neutral" fullWidth onClick={() => { setPhase(PHASE.JOINING); setError('') }}>
              Return to Menu
            </OutlineButton>
          </div>
        </div>
      )}
    </HudViewport>
    </MobileCtx.Provider>
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
  const isMobile = useContext(MobileCtx)
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
        width: fullWidth || isMobile ? '100%' : 'auto',
        minWidth: fullWidth || isMobile ? 'auto' : 240,
      }}>
      {children}
    </button>
  )
}

function ScoreCard({ label, score, winner }) {
  const isMobile = useContext(MobileCtx)
  const [filled, setFilled] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setFilled(score ?? 0), 120)
    return () => clearTimeout(t)
  }, [score])

  const accent      = winner ? '#22d3ee' : '#ef4444'
  const borderColor = winner ? 'rgba(34,211,238,0.6)' : 'rgba(239,68,68,0.6)'
  const bgColor     = winner ? 'rgba(34,211,238,0.08)' : 'rgba(239,68,68,0.08)'
  const glowColor   = winner ? 'rgba(34,211,238,0.45)' : 'rgba(239,68,68,0.45)'
  const barColor    = score >= 70 ? '#22d3ee' : score >= 40 ? '#facc15' : '#ef4444'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: isMobile ? '14px 16px 12px' : '22px 28px 18px',
      border: `2px solid ${borderColor}`,
      borderRadius: 14,
      background: bgColor,
      minWidth: isMobile ? 0 : 148, flex: isMobile ? 1 : 'none',
    }}>
      <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', fontFamily: "'Rajdhani', sans-serif" }}>
        {label}
      </span>

      <span style={{ fontSize: '3.8rem', fontWeight: 900, lineHeight: 1, color: accent, fontFamily: "'Orbitron', sans-serif", textShadow: `0 0 24px ${glowColor}` }}>
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
