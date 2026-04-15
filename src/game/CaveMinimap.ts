import { CAVE_ROOMS, CAVE_CORRIDORS } from './Cave';

/* ── Cave Minimap HUD ──────────────────────────────────────────────── */

const MAP_SIZE = 160;
const WORLD_EXTENT = 50; // world units from center to map edge

export class CaveMinimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly bgCanvas: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private visible = false;
  private lastPlayerX = Number.NaN;
  private lastPlayerZ = Number.NaN;
  private lastPlayerAngle = Number.NaN;
  private lastRenderTime = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.canvas.id = 'cave-minimap';

    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      width: `${MAP_SIZE}px`,
      height: `${MAP_SIZE}px`,
      borderRadius: '12px',
      border: '2px solid rgba(255, 200, 100, 0.4)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      zIndex: '100',
      pointerEvents: 'none',
      display: 'none',
    });

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = MAP_SIZE;
    this.bgCanvas.height = MAP_SIZE;
    this.bgCtx = this.bgCanvas.getContext('2d')!;

    this.bakeLayout();
  }

  /** Pre-render the static cave layout */
  private bakeLayout() {
    const ctx = this.bgCtx;

    // Dark background
    ctx.fillStyle = '#1a1510';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw corridors first (so rooms paint over the junctions)
    ctx.fillStyle = '#3d3528';
    for (const c of CAVE_CORRIDORS) {
      const from = CAVE_ROOMS[c.from];
      const to = CAVE_ROOMS[c.to];

      const x1 = this.worldToMap(from.cx);
      const y1 = this.worldToMap(from.cz);
      const x2 = this.worldToMap(to.cx);
      const y2 = this.worldToMap(to.cz);

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len;
      const ny = dx / len;
      const hw = (c.halfWidth / (WORLD_EXTENT * 2)) * MAP_SIZE;

      ctx.beginPath();
      ctx.moveTo(x1 + nx * hw, y1 + ny * hw);
      ctx.lineTo(x2 + nx * hw, y2 + ny * hw);
      ctx.lineTo(x2 - nx * hw, y2 - ny * hw);
      ctx.lineTo(x1 - nx * hw, y1 - ny * hw);
      ctx.closePath();
      ctx.fill();
    }

    // Draw rooms (filled squares)
    ctx.fillStyle = '#4a3f32';
    for (const room of CAVE_ROOMS) {
      const mx = this.worldToMap(room.cx);
      const my = this.worldToMap(room.cz);
      const mr = (room.radius / (WORLD_EXTENT * 2)) * MAP_SIZE;

      ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    }

    // Room outlines
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.35)';
    ctx.lineWidth = 1;
    for (const room of CAVE_ROOMS) {
      const mx = this.worldToMap(room.cx);
      const my = this.worldToMap(room.cz);
      const mr = (room.radius / (WORLD_EXTENT * 2)) * MAP_SIZE;

      ctx.strokeRect(mx - mr, my - mr, mr * 2, mr * 2);
    }
  }

  private worldToMap(coord: number): number {
    return ((coord / (WORLD_EXTENT * 2)) + 0.5) * MAP_SIZE;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  update(playerX: number, playerZ: number, playerAngle: number) {
    if (!this.visible) return;

    const now = performance.now();
    const movedEnough =
      Math.abs(playerX - this.lastPlayerX) > 0.2 ||
      Math.abs(playerZ - this.lastPlayerZ) > 0.2 ||
      Math.abs(playerAngle - this.lastPlayerAngle) > 0.03;
    if (!movedEnough && now - this.lastRenderTime < 120) return;

    this.lastRenderTime = now;
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;
    this.lastPlayerAngle = playerAngle;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.drawImage(this.bgCanvas, 0, 0);

    // Player position
    const px = this.worldToMap(playerX);
    const py = this.worldToMap(playerZ);

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

    // Player dot
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fa4';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Rounded mask
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.roundRect(0, 0, MAP_SIZE, MAP_SIZE, 12);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    this.canvas.remove();
  }
}
