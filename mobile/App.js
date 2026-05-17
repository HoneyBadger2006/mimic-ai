import { useState, useEffect, useRef } from 'react'
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  Image, ScrollView, SafeAreaView, Animated, Easing,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { io } from 'socket.io-client'

// ── Replace with your server's IP/URL ────────────────────────────────────────
const SOCKET_URL = 'http://192.168.1.100:3001'

const PHASE = {
  JOINING:  'joining',
  WAITING:  'waiting',
  PROMPT:   'prompt',
  JUDGING:  'judging',
  RESULTS:  'results',
}

const CYAN = '#22d3ee'
const RED  = '#ef4444'
const GOLD = '#facc15'

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
  const [myPhoto, setMyPhoto]   = useState(null)
  const [oppPhoto, setOppPhoto] = useState(null)
  const [tip, setTip]           = useState(null)
  const [socketId, setSocketId] = useState(null)

  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef(null)
  const socketRef = useRef(null)
  const pulseAnim = useRef(new Animated.Value(0)).current
  const scanAnim  = useRef(new Animated.Value(0)).current

  // Pulsing dot animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    ).start()
  }, [])

  // Scan line animation
  useEffect(() => {
    if (phase === PHASE.JUDGING) {
      Animated.loop(
        Animated.timing(scanAnim, { toValue: 1, duration: 1600, useNativeDriver: true, easing: Easing.linear })
      ).start()
    } else {
      scanAnim.setValue(0)
    }
  }, [phase])

  // Socket setup
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => setSocketId(socket.id))

    socket.on('game_start', () => setError(''))

    socket.on('prompt_ready', ({ prompt: p, promptScoredBy, error: e }) => {
      setPrompt(p)
      setPhase(PHASE.PROMPT)
      if (promptScoredBy === 'fallback') setError(`AI prompt failed — using fallback`)
    })

    socket.on('countdown', ({ count }) => setCountdown(count))

    socket.on('take_photo', () => captureAndSubmit())

    socket.on('judging', () => setPhase(PHASE.JUDGING))

    socket.on('game_over', ({ winner: winnerId, yourScore, oppScore: oScore, oppPhoto: oppPhotoData, tip: tipData, scoredBy, error: e }) => {
      const won = winnerId === socket.id
      setIsMe(won)
      setWinner(won ? 'win' : 'lose')
      setMyScore(yourScore ?? null)
      setOppScore(oScore ?? null)
      setOppPhoto(oppPhotoData ?? null)
      setTip(tipData ?? null)
      setPhase(PHASE.RESULTS)
      if (scoredBy === 'random') setError(`AI scoring failed — random winner`)
    })

    socket.on('error',       ({ message }) => setError(message))
    socket.on('player_left', () => {
      setError('Opponent disconnected.')
      setPhase(PHASE.WAITING)
    })

    return () => socket.disconnect()
  }, [])

  async function captureAndSubmit() {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.85 })
      setMyPhoto(`data:image/jpeg;base64,${photo.base64}`)
      socketRef.current?.emit('submit_frame', { frame: photo.base64 })
    } catch (e) {
      setError('Camera capture failed.')
    }
  }

  function handleJoin() {
    const id = roomId.trim()
    if (!id) return
    setError('')
    socketRef.current?.emit('join_room', { roomId: id })
    setPhase(PHASE.WAITING)
  }

  function handlePlayAgain() {
    setPhase(PHASE.JOINING)
    setPrompt('')
    setCountdown(null)
    setWinner('')
    setMyScore(null)
    setOppScore(null)
    setMyPhoto(null)
    setOppPhoto(null)
    setTip(null)
    setError('')
  }

  const accentColor = isMe ? CYAN : RED

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {/* Corner decorations */}
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />

      {/* Error banner */}
      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error.toUpperCase()}</Text>
        </View>
      )}

      {/* ── JOINING ──────────────────────────────────────────────────────── */}
      {phase === PHASE.JOINING && (
        <View style={styles.centered}>
          <Text style={styles.wordmark}>MIMIC</Text>
          <Text style={styles.subtitle}>AI · FACE · BATTLE</Text>

          <View style={styles.statusTag}>
            <View style={styles.statusDot} />
            <Text style={styles.statusTagText}>LOCAL · 1v1</Text>
          </View>

          <TextInput
            style={styles.input}
            value={roomId}
            onChangeText={setRoomId}
            onSubmitEditing={handleJoin}
            placeholder="ENTER ROOM ID"
            placeholderTextColor="rgba(34,211,238,0.4)"
            autoCapitalize="characters"
            returnKeyType="join"
          />
          <CyanButton onPress={handleJoin}>JOIN GAME</CyanButton>
        </View>
      )}

      {/* ── WAITING ──────────────────────────────────────────────────────── */}
      {phase === PHASE.WAITING && (
        <View style={styles.centered}>
          <PulsingDots anim={pulseAnim} />
          <Text style={styles.eyebrow}>Waiting for opponent</Text>
          <View style={styles.statusTag}>
            <View style={styles.statusDot} />
            <Text style={styles.statusTagText}>ROOM: {roomId}</Text>
          </View>
        </View>
      )}

      {/* ── PROMPT ───────────────────────────────────────────────────────── */}
      {phase === PHASE.PROMPT && (
        <View style={styles.flex1}>
          {permission?.granted ? (
            <CameraView ref={cameraRef} style={styles.camera} facing="front">
              {/* REC indicator */}
              <View style={styles.recRow}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>REC</Text>
              </View>
              {/* Overlay: prompt + countdown */}
              <View style={styles.cameraOverlay}>
                <Text style={styles.eyebrow}>CHALLENGE</Text>
                <Text style={styles.promptText}>{prompt}</Text>
                {countdown !== null && (
                  <CountdownRing seconds={countdown} />
                )}
              </View>
            </CameraView>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.eyebrow}>Camera permission needed</Text>
              <CyanButton onPress={requestPermission}>GRANT PERMISSION</CyanButton>
            </View>
          )}
        </View>
      )}

      {/* ── JUDGING ──────────────────────────────────────────────────────── */}
      {phase === PHASE.JUDGING && (
        <View style={styles.centered}>
          <View style={styles.scanFrame}>
            <Animated.View style={[styles.scanLine, {
              transform: [{ translateY: scanAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 280] }) }],
            }]} />
            <Text style={styles.scanLabel}>ANALYZING…</Text>
          </View>
          <Text style={styles.eyebrow}>{prompt}</Text>
          <PulsingDots anim={pulseAnim} />
          <Text style={styles.eyebrow}>AI is grading your face</Text>
        </View>
      )}

      {/* ── RESULTS ──────────────────────────────────────────────────────── */}
      {phase === PHASE.RESULTS && (
        <ScrollView contentContainerStyle={styles.resultsContainer}>
          <Text style={[styles.eyebrow, { color: accentColor }]}>YOU</Text>
          <Text style={[styles.verdictText, { color: accentColor, textShadowColor: accentColor }]}>
            {winner.toUpperCase()}
          </Text>

          {/* Scores */}
          <View style={styles.scoreRow}>
            <ScoreCard label="You"      score={myScore}  highlight={isMe} />
            <ScoreCard label="Opponent" score={oppScore} highlight={!isMe} />
          </View>

          {/* Challenge used */}
          {!!prompt && (
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.miniLabel}>CHALLENGE</Text>
              <Text style={styles.promptSmall}>{prompt}</Text>
            </View>
          )}

          {/* Photos */}
          {(myPhoto || oppPhoto) && (
            <View style={styles.photoRow}>
              {myPhoto && (
                <View style={styles.photoCol}>
                  <Text style={[styles.miniLabel, { color: isMe ? CYAN : 'rgba(255,255,255,0.35)' }]}>YOU</Text>
                  <Image source={{ uri: myPhoto }} style={[styles.photo, { borderColor: isMe ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.15)' }]} />
                </View>
              )}
              {oppPhoto && (
                <View style={styles.photoCol}>
                  <Text style={[styles.miniLabel, { color: !isMe ? CYAN : 'rgba(255,255,255,0.35)' }]}>OPPONENT</Text>
                  <Image source={{ uri: `data:image/jpeg;base64,${oppPhoto}` }} style={[styles.photo, { borderColor: !isMe ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.15)' }]} />
                </View>
              )}
            </View>
          )}

          {/* AI tip */}
          {!!tip && (
            <View style={styles.tipBox}>
              <Text style={styles.tipLabel}>AI TIP — HOW TO IMPROVE</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          )}

          <View style={styles.buttonStack}>
            <CyanButton onPress={handlePlayAgain}>PLAY AGAIN</CyanButton>
            <NeutralButton onPress={() => { setPhase(PHASE.JOINING); setError('') }}>RETURN TO MENU</NeutralButton>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ── UI Components ─────────────────────────────────────────────────────────────

function CyanButton({ onPress, children }) {
  return (
    <TouchableOpacity style={styles.cyanBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.cyanBtnText}>{children}</Text>
    </TouchableOpacity>
  )
}

function NeutralButton({ onPress, children }) {
  return (
    <TouchableOpacity style={styles.neutralBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.neutralBtnText}>{children}</Text>
    </TouchableOpacity>
  )
}

function PulsingDots({ anim }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginVertical: 12 }}>
      {[0, 1, 2, 3].map(i => (
        <Animated.View key={i} style={[styles.pulseDot, { opacity: anim }]} />
      ))}
    </View>
  )
}

function CountdownRing({ seconds }) {
  const urgent = seconds <= 2
  return (
    <View style={[styles.countdownRing, urgent && styles.countdownRingUrgent]}>
      <Text style={[styles.countdownNum, urgent && styles.countdownNumUrgent]}>{seconds}</Text>
    </View>
  )
}

function ScoreCard({ label, score, highlight }) {
  const barColor = score >= 70 ? CYAN : score >= 40 ? GOLD : RED
  const accent   = highlight ? CYAN : 'rgba(255,255,255,0.55)'
  return (
    <View style={[styles.scoreCard, highlight && styles.scoreCardHL]}>
      <Text style={styles.scoreLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.scoreValue, { color: accent }]}>{score != null ? `${score}%` : '--'}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${score ?? 0}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  flex1: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 32,
  },

  // Corner brackets
  corner: { position: 'absolute', width: 24, height: 24, borderColor: 'rgba(255,255,255,0.15)', borderStyle: 'solid' },
  cornerTL: { top: 16, left: 16,  borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: 16, right: 16, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: 16, left: 16,  borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: 16, right: 16, borderBottomWidth: 2, borderRightWidth: 2 },

  // Error
  errorBanner: {
    position: 'absolute', top: 52, alignSelf: 'center', zIndex: 99,
    paddingVertical: 8, paddingHorizontal: 20,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)',
    borderRadius: 4,
  },
  errorText: { color: '#fca5a5', fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  // Wordmark
  wordmark: {
    fontSize: 80, fontWeight: '900', color: CYAN,
    letterSpacing: 6, textTransform: 'uppercase',
    textShadowColor: 'rgba(34,211,238,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 24,
  },
  subtitle: {
    fontSize: 13, color: 'rgba(34,211,238,0.5)',
    letterSpacing: 6, textTransform: 'uppercase', fontWeight: '500',
  },

  // Status tag
  statusTag: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(34,211,238,0.45)',
    borderRadius: 999,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: CYAN,
    shadowColor: CYAN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 4,
  },
  statusTagText: { color: '#67e8f9', fontSize: 11, fontWeight: '700', letterSpacing: 3 },

  // Input
  input: {
    width: 280, paddingVertical: 14, paddingHorizontal: 24,
    borderWidth: 2, borderColor: 'rgba(34,211,238,0.45)',
    borderRadius: 8, color: '#fff',
    fontSize: 16, fontWeight: '700',
    letterSpacing: 4, textAlign: 'center',
  },

  // Eyebrow
  eyebrow: {
    color: CYAN, fontSize: 13, fontWeight: '700',
    letterSpacing: 4, textTransform: 'uppercase', textAlign: 'center',
  },

  // Camera
  camera: { flex: 1 },
  recRow: {
    position: 'absolute', top: 48, right: 18,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  recDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: RED,
  },
  recText: { color: '#fca5a5', fontSize: 11, fontWeight: '700', letterSpacing: 3 },
  cameraOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 24, alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  // Prompt text
  promptText: {
    color: '#fff', fontSize: 28, fontWeight: '900',
    textTransform: 'uppercase', letterSpacing: 2,
    textAlign: 'center', lineHeight: 34,
    textShadowColor: 'rgba(255,255,255,0.2)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  promptSmall: {
    color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '700',
    letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
  },

  // Countdown ring
  countdownRing: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, borderColor: 'rgba(34,211,238,0.55)',
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  countdownRingUrgent: { borderColor: RED },
  countdownNum: { color: '#fff', fontSize: 64, fontWeight: '900', lineHeight: 70 },
  countdownNumUrgent: { color: RED },

  // Scan frame
  scanFrame: {
    width: 280, height: 280,
    borderWidth: 1, borderColor: 'rgba(34,211,238,0.3)',
    overflow: 'hidden', marginBottom: 24,
    alignItems: 'center', justifyContent: 'flex-end',
    backgroundColor: 'rgba(5,8,16,0.8)',
  },
  scanLine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
    backgroundColor: CYAN,
    shadowColor: CYAN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8,
  },
  scanLabel: {
    color: CYAN, fontSize: 13, fontWeight: '700',
    letterSpacing: 5, textTransform: 'uppercase', marginBottom: 16,
  },

  // Pulsing dot
  pulseDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: CYAN,
    shadowColor: CYAN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6,
  },

  // Buttons
  cyanBtn: {
    width: '100%', maxWidth: 320,
    paddingVertical: 16, paddingHorizontal: 32,
    borderWidth: 2, borderColor: CYAN, borderRadius: 8,
    alignItems: 'center',
  },
  cyanBtnText: { color: CYAN, fontSize: 16, fontWeight: '700', letterSpacing: 3 },
  neutralBtn: {
    width: '100%', maxWidth: 320,
    paddingVertical: 16, paddingHorizontal: 32,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 8,
    alignItems: 'center',
  },
  neutralBtnText: { color: 'rgba(255,255,255,0.78)', fontSize: 16, fontWeight: '700', letterSpacing: 3 },

  // Results
  resultsContainer: {
    alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 24,
  },
  verdictText: {
    fontSize: 80, fontWeight: '900', letterSpacing: 4,
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 32,
  },
  scoreRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  scoreCard: {
    alignItems: 'center', gap: 8,
    paddingVertical: 22, paddingHorizontal: 24,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)',
    minWidth: 140,
  },
  scoreCardHL: { borderColor: 'rgba(34,211,238,0.6)', backgroundColor: 'rgba(34,211,238,0.08)' },
  scoreLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase' },
  scoreValue: { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  barTrack: {
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  // Photos
  photoRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  photoCol: { alignItems: 'center', gap: 6 },
  photo: { width: 160, height: 160, borderRadius: 10, borderWidth: 2 },
  miniLabel: {
    color: 'rgba(255,255,255,0.35)', fontSize: 10,
    letterSpacing: 3, textTransform: 'uppercase', fontWeight: '700',
  },

  // Tip
  tipBox: {
    maxWidth: 360, padding: 18,
    borderWidth: 1, borderColor: 'rgba(250,204,21,0.35)',
    borderRadius: 10, backgroundColor: 'rgba(250,204,21,0.06)',
    alignItems: 'center', gap: 8,
  },
  tipLabel: { color: GOLD, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', fontWeight: '700' },
  tipText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', letterSpacing: 1, textAlign: 'center', lineHeight: 22 },

  // Button stack
  buttonStack: { width: '100%', alignItems: 'center', gap: 12, marginTop: 8 },
})
