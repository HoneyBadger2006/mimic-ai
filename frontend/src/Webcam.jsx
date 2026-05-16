import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5000';

// Exposes socket ref so GameUI (Lam) can attach game-event listeners to the same socket.
export default function Webcam({ roomId, socketRef: externalSocketRef }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const internalSocketRef = useRef(null);
  const socketRef = externalSocketRef ?? internalSocketRef;
  const [capturedFrame, setCapturedFrame] = useState(null);

  // Webcam stream
  useEffect(() => {
    let stream;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((err) => console.error('getUserMedia error:', err));

    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Socket connection — only create one if no external ref is provided
  useEffect(() => {
    if (externalSocketRef) return; // GameUI owns the socket
    const socket = io(SOCKET_URL);
    internalSocketRef.current = socket;
    socket.emit('join_room', { room: roomId });
    return () => socket.disconnect();
  }, [roomId, externalSocketRef]);

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const base64 = canvas.toDataURL('image/jpeg');
    setCapturedFrame(base64);
    console.log('Captured base64 JPEG:', base64);

    if (socketRef.current) {
      socketRef.current.emit('submit_frame', { room: roomId, frame: base64 });
    }
  }

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <button onClick={captureFrame}>Capture</button>
      {capturedFrame && (
        <img src={capturedFrame} alt="Captured frame" width={320} />
      )}
    </div>
  );
}
