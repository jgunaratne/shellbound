import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [locked, setLocked] = useState(false);
  const [mangoCount, setMangoCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game(canvas);
    gameRef.current = game;

    game.onMangoCollected = () => {
      setMangoCount((count) => count + 1);
    };

    game.start();

    const onLockChange = () => {
      setLocked(document.pointerLockElement === canvas);
    };
    document.addEventListener('pointerlockchange', onLockChange);

    return () => {
      game.dispose();
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />

      <div className="hud">
        <p style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#ffbb00', marginBottom: 8 }}>
          🥭 Mangos Collected: {mangoCount}
        </p>
        <p>WASD — Move</p>
        <p>Mouse — Look {locked ? '(locked)' : ''}</p>
        <p>1 / 2 — Outdoor presets</p>
        <p>9 — Cave scene</p>
        {!locked && <p style={{ color: '#ffdd88', marginTop: 6 }}>Click to capture mouse</p>}
      </div>
    </>
  );
}
