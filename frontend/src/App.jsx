import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import GameUI from './GameUI'

const socket = io('http://localhost:3001')

const PHASE = {
  JOINING: 'joining',
  WAITING_TO_START: 'waiting_to_start',
  PROMPT: 'prompt',
  WAITING_FOR_OPPONENT: 'waiting_for_opponent',
  RESULTS: 'results',
}

export default function App() {
  const [phase, setPhase] = useState(PHASE.JOINING)
  const [roomId, setRoomId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [myScore, setMyScore] = useState(0)
  const [oppScore, setOppScore] = useState(0)
  const [winner, setWinner] = useState('')
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    socket.on('prompt_ready', ({ prompt: p }) => {
      setPrompt(p)
      setPhase(PHASE.PROMPT)
      startWebcam()
    })

    socket.on('score_result', ({ score }) => {
      setMyScore(score)
    })

    socket.on('game_over', ({ winner: winnerId, scores }) => {
      const myId = socket.id
      const oppId = Object.keys(scores).find(id => id !== myId)
      const myS = scores[myId] ?? 0
      const oppS = scores[oppId] ?? 0
      setMyScore(myS)
      setOppScore(oppS)
      setWinner(myS === oppS ? 'Tie' : winnerId === myId ? 'You' : 'Opponent')
      setPhase(PHASE.RESULTS)
      stopWebcam()
    })

    socket.on('error', ({ message }) => setError(message))

    socket.on('player_left', () => {
      setError('Opponent disconnected.')
      setPhase(PHASE.WAITING_TO_START)
      stopWebcam()
    })

    return () => {
      socket.off('prompt_ready')
      socket.off('score_result')
      socket.off('game_over')
      socket.off('error')
      socket.off('player_left')
    }
  }, [])

  async function startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(console.error)
    if (!stream) return
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream
  }

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function handleJoinRoom() {
    const id = roomId.trim()
    if (!id) return
    setError('')
    socket.emit('join_room', { roomId: id })
    setPhase(PHASE.WAITING_TO_START)
  }

  function handleSubmit() {
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    if (video && video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
    }
    socket.emit('submit_frame', { frame: canvas.toDataURL('image/jpeg', 0.7) })
    setPhase(PHASE.WAITING_FOR_OPPONENT)
    stopWebcam()
  }

  function handlePlayAgain() {
    setPhase(PHASE.JOINING)
    setMyScore(0)
    setOppScore(0)
    setWinner('')
    setPrompt('')
    setError('')
  }

  // Pre-join screen — not part of GameUI since GameUI has no room input
  if (phase === PHASE.JOINING) {
    return (
      <div style={joinScreen}>
        <h1 style={{ fontSize: '3rem', fontWeight: 800, margin: 0, letterSpacing: '-1px' }}>
          Mimic-AI
        </h1>
        {error && <p style={{ color: '#ff4d4d', margin: 0 }}>{error}</p>}
        <input
          style={inputStyle}
          value={roomId}
          onChange={e => setRoomId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleJoinRoom()}
          placeholder="Enter room ID"
          autoFocus
        />
        <button style={btnStyle} onClick={handleJoinRoom}>
          Join Game
        </button>
      </div>
    )
  }

  return (
    <>
      {error && <p style={errorBanner}>{error}</p>}

      {/* Webcam preview — bottom-right corner during PROMPT phase */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          ...webcamStyle,
          display: phase === PHASE.PROMPT ? 'block' : 'none',
        }}
      />

      <GameUI
        phase={phase}
        prompt={prompt}
        myScore={myScore}
        oppScore={oppScore}
        winner={winner}
        onSubmit={handleSubmit}
        onJoinRoom={handlePlayAgain}
      />
    </>
  )
}

const joinScreen = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1.25rem',
  background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
  fontFamily: "'Segoe UI', sans-serif",
  color: '#fff',
}

const inputStyle = {
  padding: '0.75rem 1.25rem',
  fontSize: '1.1rem',
  borderRadius: '999px',
  border: '2px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  outline: 'none',
  width: 260,
  textAlign: 'center',
}

const btnStyle = {
  padding: '0.85rem 2.5rem',
  fontSize: '1.1rem',
  fontWeight: 700,
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(90deg, #f9e04b, #f7971e)',
  color: '#111',
  cursor: 'pointer',
}

const errorBanner = {
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
}

const webcamStyle = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  width: 200,
  borderRadius: 12,
  border: '2px solid rgba(255,255,255,0.2)',
  zIndex: 10,
}
