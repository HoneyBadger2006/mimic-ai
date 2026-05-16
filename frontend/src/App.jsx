import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const socket = io('http://localhost:3001')

const PHASE = {
  JOINING: 'joining',
  WAITING: 'waiting',
  PROMPT: 'prompt',
  JUDGING: 'judging',
  RESULTS: 'results',
}

export default function App() {
  const [phase, setPhase] = useState(PHASE.JOINING)
  const [roomId, setRoomId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [countdown, setCountdown] = useState(null)
  const [winner, setWinner] = useState('')
  const [isMe, setIsMe] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    socket.on('game_start', () => {
      setError('')
    })

    socket.on('prompt_ready', ({ prompt: p }) => {
      setPrompt(p)
      setPhase(PHASE.PROMPT)
      startWebcam()
    })

    socket.on('countdown', ({ count }) => {
      setCountdown(count)
    })

    socket.on('take_photo', () => {
      captureAndSubmit()
    })

    socket.on('judging', () => {
      setPhase(PHASE.JUDGING)
      stopWebcam()
    })

    socket.on('game_over', ({ winner: winnerId }) => {
      setIsMe(winnerId === socket.id)
      setWinner(winnerId === socket.id ? 'You win!' : 'Opponent wins!')
      setPhase(PHASE.RESULTS)
    })

    socket.on('error', ({ message }) => setError(message))

    socket.on('player_left', () => {
      setError('Opponent disconnected.')
      setPhase(PHASE.WAITING)
      stopWebcam()
    })

    return () => {
      socket.off('game_start')
      socket.off('prompt_ready')
      socket.off('countdown')
      socket.off('take_photo')
      socket.off('judging')
      socket.off('game_over')
      socket.off('error')
      socket.off('player_left')
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
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    if (video && video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
    }
    // strip the data URI prefix — scorer expects raw base64
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
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
    setError('')
  }

  return (
    <div style={s.root}>
      {error && <p style={s.errorBanner}>{error}</p>}

      {/* Live webcam — bottom-right during prompt phase */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ ...s.webcam, display: phase === PHASE.PROMPT ? 'block' : 'none' }}
      />

      <div style={s.card}>
        {phase === PHASE.JOINING && (
          <>
            <h1 style={s.title}>Mimic-AI</h1>
            <input
              style={s.input}
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="Enter room ID"
              autoFocus
            />
            <button style={s.btn} onClick={handleJoin}>Join Game</button>
          </>
        )}

        {phase === PHASE.WAITING && (
          <>
            <div style={s.spinner} />
            <h2 style={s.heading}>Waiting for opponent…</h2>
            <p style={s.sub}>Room: <strong>{roomId}</strong></p>
          </>
        )}

        {phase === PHASE.PROMPT && (
          <>
            <p style={s.label}>YOUR CHALLENGE</p>
            <h1 style={s.promptText}>{prompt}</h1>
            {countdown !== null && (
              <div style={{ ...s.countdown, ...(countdown <= 1 ? s.countdownUrgent : {}) }}>
                {countdown}
              </div>
            )}
            <p style={s.sub}>Get ready — photo auto-captures!</p>
          </>
        )}

        {phase === PHASE.JUDGING && (
          <>
            <div style={s.spinner} />
            <h2 style={s.heading}>AI is judging…</h2>
          </>
        )}

        {phase === PHASE.RESULTS && (
          <>
            <h1 style={{ ...s.promptText, color: isMe ? '#f9e04b' : '#fff' }}>{winner}</h1>
            <button style={s.btn} onClick={handlePlayAgain}>Play Again</button>
          </>
        )}
      </div>
    </div>
  )
}

const s = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    fontFamily: "'Segoe UI', sans-serif",
    color: '#fff',
    padding: '1rem',
  },
  card: {
    background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(12px)',
    borderRadius: '1.5rem',
    padding: '3rem 2.5rem',
    textAlign: 'center',
    maxWidth: 520,
    width: '100%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.5rem',
  },
  title: { fontSize: '3rem', fontWeight: 800, margin: 0, letterSpacing: '-1px' },
  heading: { fontSize: '1.6rem', fontWeight: 700, margin: 0 },
  sub: { fontSize: '1rem', color: 'rgba(255,255,255,0.55)', margin: 0 },
  label: {
    fontSize: '0.85rem',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'rgba(255,255,255,0.5)',
    margin: 0,
  },
  promptText: {
    fontSize: 'clamp(2rem, 5vw, 3rem)',
    fontWeight: 900,
    lineHeight: 1.1,
    margin: 0,
    color: '#f9e04b',
    textShadow: '0 0 20px rgba(249,224,75,0.5)',
  },
  countdown: {
    fontSize: '6rem',
    fontWeight: 900,
    lineHeight: 1,
    color: '#fff',
    transition: 'color 0.3s, transform 0.3s',
  },
  countdownUrgent: {
    color: '#ff4d4d',
    transform: 'scale(1.2)',
    textShadow: '0 0 24px rgba(255,77,77,0.7)',
  },
  input: {
    padding: '0.75rem 1.25rem',
    fontSize: '1.1rem',
    borderRadius: '999px',
    border: '2px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    outline: 'none',
    width: 260,
    textAlign: 'center',
  },
  btn: {
    padding: '0.85rem 2.5rem',
    fontSize: '1.1rem',
    fontWeight: 700,
    borderRadius: '999px',
    border: 'none',
    background: 'linear-gradient(90deg, #f9e04b, #f7971e)',
    color: '#111',
    cursor: 'pointer',
    letterSpacing: '0.04em',
  },
  spinner: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    border: '6px solid rgba(255,255,255,0.15)',
    borderTopColor: '#f9e04b',
    animation: 'spin 0.9s linear infinite',
  },
  errorBanner: {
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    color: '#ff4d4d',
    background: '#1a1a2e',
    padding: '0.5rem 1.25rem',
    borderRadius: 8,
    margin: 0,
    zIndex: 99,
  },
  webcam: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    width: 200,
    borderRadius: 12,
    border: '2px solid rgba(255,255,255,0.2)',
    zIndex: 10,
  },
}

// spinner keyframe
const tag = document.createElement('style')
tag.textContent = '@keyframes spin { to { transform: rotate(360deg); } }'
document.head.appendChild(tag)
