import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [locked, setLocked] = useState(false);
  const [mangoCount, setMangoCount] = useState(0);
  const [showHud, setShowHud] = useState(false);

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

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') {
        setShowHud((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      game.dispose();
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />

      {showHud && (
        <div className="hud">
          <p style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#ffbb00', marginBottom: 8 }}>
            🥭 Mangos Collected: {mangoCount}
          </p>
          <p>WASD — Move</p>
          <p>Mouse — Look {locked ? '(locked)' : ''}</p>
          <p>1 / 2 — Outdoor presets</p>
          <p>9 — Cave scene</p>
          {!locked && <p style={{ color: '#ffdd88', marginTop: 6 }}>Click to capture mouse</p>}
          <p style={{ color: '#888', marginTop: 6, fontSize: '0.85em' }}>Press T to hide</p>
        </div>
      )}

      {!showHud && (
        <div className="hud" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          <p style={{ fontSize: '0.85em' }}>Press T for controls</p>
        </div>
      )}
    </>
  );
}
