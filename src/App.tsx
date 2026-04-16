import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';

type NpcScore = { id: number; name: string; score: number };

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [locked, setLocked] = useState(false);
  const [mangoCount, setMangoCount] = useState(0);
  const [showHud, setShowHud] = useState(false);
  const [npcScores, setNpcScores] = useState<NpcScore[]>([]);
  const [mangosRemaining, setMangosRemaining] = useState(-1); // -1 = not yet loaded
  const [gameOver, setGameOver] = useState(false);
  const [gameTimeStr, setGameTimeStr] = useState('12:00 PM');
  const [timePeriod, setTimePeriod] = useState('Day');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game(canvas);
    gameRef.current = game;

    game.onMangoCollected = () => {
      setMangoCount((count) => count + 1);
    };

    game.onNpcScoresUpdated = (scores) => {
      setNpcScores(scores);
    };

    game.onMangosRemainingUpdated = (remaining) => {
      setMangosRemaining(remaining);
      if (remaining === 0) {
        setGameOver(true);
        setShowHud(true);
        document.exitPointerLock();
      }
    };

    game.onTimeUpdated = (timeStr, period) => {
      setGameTimeStr(timeStr);
      setTimePeriod(period);
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

  // Build sorted rankings: player + NPCs, sorted by score descending
  const allRankings = [
    { name: 'You', score: mangoCount, isPlayer: true },
    ...npcScores.map((npc) => ({ name: npc.name, score: npc.score, isPlayer: false })),
  ].sort((a, b) => b.score - a.score);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />

      {/* Game Over Announcement */}
      {gameOver && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.65)',
          zIndex: 100,
        }}>
          <div style={{
            background: 'rgba(20, 15, 10, 0.95)',
            border: '2px solid #ffbb00',
            borderRadius: 12,
            padding: '32px 48px',
            textAlign: 'center',
            maxWidth: 400,
            color: '#eee',
          }}>
            <p style={{ fontSize: '1.6em', fontWeight: 'bold', color: '#ffbb00', marginBottom: 4 }}>
              🏆 All Mangos Collected!
            </p>
            <p style={{ fontSize: '1.1em', color: '#ffdd88', marginBottom: 16 }}>
              Winner: {allRankings[0]?.name} with {allRankings[0]?.score} mangos!
            </p>
            <div style={{ textAlign: 'left', marginBottom: 16 }}>
              {allRankings.map((entry, i) => (
                <p key={entry.name} style={{
                  color: entry.isPlayer ? '#ffbb00' : '#ccc',
                  fontWeight: i === 0 ? 'bold' : 'normal',
                  marginBottom: 2,
                }}>
                  {i + 1}. {entry.name}: {entry.score}
                </p>
              ))}
            </div>
            <button
              onClick={() => {
                gameRef.current?.restartMangoGame();
                setMangoCount(0);
                setNpcScores([]);
                setMangosRemaining(-1);
                setGameOver(false);
              }}
              style={{
                padding: '10px 28px',
                fontSize: '1.1em',
                fontWeight: 'bold',
                color: '#1a1206',
                background: 'linear-gradient(135deg, #ffcc00, #ff9900)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              🥭 Play Again
            </button>
          </div>
        </div>
      )}

      {showHud && (
        <div className="hud">
          <p style={{ fontSize: '1.1em', fontWeight: 'bold', color: '#ddd', marginBottom: 8 }}>
            🕐 {gameTimeStr} — {timePeriod}
          </p>
          <p style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#ffbb00', marginBottom: 4 }}>
            🥭 Mangos Collected: {mangoCount}
          </p>
          {mangosRemaining >= 0 && (
            <p style={{ fontSize: '0.9em', color: '#aaa', marginBottom: 8 }}>
              Remaining: {mangosRemaining}
            </p>
          )}

          <div style={{ marginBottom: 12, padding: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '4px' }}>
            <p style={{ fontWeight: 'bold', color: '#aaa', marginBottom: 4 }}>Scorecard</p>
            <div style={{ fontSize: '0.9em' }}>
              {allRankings.map((entry, i) => (
                <p key={entry.name} style={{
                  color: entry.isPlayer ? '#ffbb00' : '#ccc',
                  fontWeight: entry.isPlayer ? 'bold' : 'normal',
                  marginBottom: 2,
                }}>
                  {i + 1}. {entry.name}: {entry.score}
                </p>
              ))}
            </div>
          </div>

          <p>WASD — Move</p>
          <p>Mouse — Look {locked ? '(locked)' : ''}</p>
          <p>Scroll — Zoom</p>
          <p>9 — Cave scene</p>
          {!locked && <p style={{ color: '#ffdd88', marginTop: 6 }}>Click to capture mouse</p>}
          <p style={{ color: '#888', marginTop: 6, fontSize: '0.85em' }}>Press T to hide</p>
        </div>
      )}

      {!showHud && !gameOver && (
        <div className="hud" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          <p style={{ fontSize: '0.85em' }}>Press T for controls</p>
        </div>
      )}
    </>
  );
}
