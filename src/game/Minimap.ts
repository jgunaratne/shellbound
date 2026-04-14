import { getTerrainHeight } from './Terrain';

/* ── Minimap HUD ────────────────────────────────────────────────────── */

const MAP_SIZE = 160;        // pixel size of the minimap
const TERRAIN_HALF = 150;    // world units from center to edge
const WATER_LEVEL = -1.9;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainImage: ImageData;
  private visible = true;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor() {
    // Create an overlay canvas anchored to the top-right corner
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.canvas.id = 'minimap';

    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      width: `${MAP_SIZE}px`,
      height: `${MAP_SIZE}px`,
      borderRadius: '12px',
      border: '2px solid rgba(255, 255, 255, 0.35)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      zIndex: '100',
      pointerEvents: 'none',
      imageRendering: 'pixelated',
    });

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Pre-render the static terrain heightmap
    this.terrainImage = this.ctx.createImageData(MAP_SIZE, MAP_SIZE);
    this.bakeTerrainImage();

    // Toggle with M key
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        this.visible = !this.visible;
        this.canvas.style.display = this.visible ? 'block' : 'none';
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Sample the terrain once and create a static background image */
  private bakeTerrainImage() {
    const data = this.terrainImage.data;

    for (let py = 0; py < MAP_SIZE; py++) {
      for (let px = 0; px < MAP_SIZE; px++) {
        // Map pixel coords to world coords
        const wx = ((px / MAP_SIZE) - 0.5) * TERRAIN_HALF * 2;
        const wz = ((py / MAP_SIZE) - 0.5) * TERRAIN_HALF * 2;

        const h = getTerrainHeight(wx, wz);
        const i = (py * MAP_SIZE + px) * 4;

        if (h < WATER_LEVEL) {
          // Water — dark blue, deeper = darker
          const depth = Math.min(1, (WATER_LEVEL - h) / 8);
          data[i]     = Math.floor(8 + 20 * (1 - depth));    // R
          data[i + 1] = Math.floor(30 + 50 * (1 - depth));   // G
          data[i + 2] = Math.floor(80 + 80 * (1 - depth));   // B
          data[i + 3] = 255;
        } else {
          // Land — green, higher = lighter
          const t = Math.min(1, Math.max(0, (h + 2) / 14));
          data[i]     = Math.floor(35 + 60 * t);   // R
          data[i + 1] = Math.floor(70 + 80 * t);   // G
          data[i + 2] = Math.floor(25 + 30 * t);   // B
          data[i + 3] = 255;
        }
      }
    }
  }

  /** Call every frame with the player's world position and facing angle */
  update(
    playerX: number,
    playerZ: number,
    playerAngle: number,
    npcPositions?: { x: number; z: number }[],
  ) {
    if (!this.visible) return;
    const ctx = this.ctx;

    // Draw the static terrain background
    ctx.putImageData(this.terrainImage, 0, 0);

    // Slight darkening overlay for contrast
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // ── Draw NPC dots ──
    if (npcPositions) {
      ctx.fillStyle = '#f5c842'; // warm yellow
      for (const npc of npcPositions) {
        const nx = ((npc.x / (TERRAIN_HALF * 2)) + 0.5) * MAP_SIZE;
        const ny = ((npc.z / (TERRAIN_HALF * 2)) + 0.5) * MAP_SIZE;
        ctx.beginPath();
        ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Draw player dot with direction indicator ──
    const px = ((playerX / (TERRAIN_HALF * 2)) + 0.5) * MAP_SIZE;
    const py = ((playerZ / (TERRAIN_HALF * 2)) + 0.5) * MAP_SIZE;

    // Direction arrow
    const arrowLen = 8;
    const ax = px + Math.sin(playerAngle) * arrowLen;
    const ay = py + Math.cos(playerAngle) * arrowLen;

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // Player dot (white with colored ring)
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#4af';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Rounded mask (clip corners) ──
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.roundRect(0, 0, MAP_SIZE, MAP_SIZE, 12);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas.remove();
  }
}
