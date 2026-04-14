import * as THREE from 'three';
import { perlin2 } from './Terrain';

// ─── Layout ──────────────────────────────────────────────────────

type Rect = { x1: number; z1: number; x2: number; z2: number };

const FLOOR_Y = 0;
const WALL_HEIGHT = 10;
const WALL_THICKNESS = 3;
const PLAYER_MARGIN = 1.8;
const FLOOR_NOISE_SCALE = 0.15;
const FLOOR_NOISE_AMP = 0.45;
const WALL_NOISE_SCALE = 0.25;
const WALL_NOISE_AMP = 0.6;
const FLOOR_SUBDIVS = 32; // subdivisions per floor/ceiling plane
const WALL_SUBDIVS = 12;  // subdivisions per wall segment

export const CAVE_SPAWN = new THREE.Vector3(0, FLOOR_Y, 0);

// ── Rooms ────────────────────────────────────────────────────────
const ROOMS: Rect[] = [
  { x1: -20, z1: -20, x2: 20, z2: 20 },
  { x1: 50, z1: -18, x2: 90, z2: 18 },
  { x1: -18, z1: -80, x2: 18, z2: -50 },
  { x1: -90, z1: -18, x2: -50, z2: 18 },
  { x1: -18, z1: 50, x2: 18, z2: 80 },
];

// ── Corridors (overlap 4 units into rooms) ───────────────────────
const OVERLAP = 4;
const CORRIDORS: Rect[] = [
  { x1: 20 - OVERLAP, z1: -5, x2: 50 + OVERLAP, z2: 5 },
  { x1: -5, z1: -50 + OVERLAP, x2: 5, z2: -20 + OVERLAP },
  { x1: -50 - OVERLAP, z1: -5, x2: -20 + OVERLAP, z2: 5 },
  { x1: -5, z1: 20 - OVERLAP, x2: 5, z2: 50 + OVERLAP },
];

const ALL_WALKABLE: Rect[] = [...ROOMS, ...CORRIDORS];

export const CAVE_BOUNDS = {
  minX: -92,
  maxX: 92,
  minZ: -82,
  maxZ: 82,
};

// ─── Cave ground height (exported for player grounding) ──────────
export function getCaveFloorHeight(x: number, z: number): number {
  const n1 = perlin2(x * FLOOR_NOISE_SCALE + 200, z * FLOOR_NOISE_SCALE + 200);
  const n2 = perlin2(x * FLOOR_NOISE_SCALE * 2.3 + 50, z * FLOOR_NOISE_SCALE * 2.3 + 50);
  return FLOOR_Y + (n1 * 0.7 + n2 * 0.3) * FLOOR_NOISE_AMP;
}

// ─── Walkability ─────────────────────────────────────────────────
export function isInsideCaveLayout(x: number, z: number): boolean {
  for (const r of ALL_WALKABLE) {
    if (
      x >= r.x1 + PLAYER_MARGIN &&
      x <= r.x2 - PLAYER_MARGIN &&
      z >= r.z1 + PLAYER_MARGIN &&
      z <= r.z2 - PLAYER_MARGIN
    ) {
      return true;
    }
  }
  return false;
}

// ─── Materials ───────────────────────────────────────────────────
function stoneFloorMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x564a3c,
    roughness: 0.94,
    metalness: 0.05,
    side: THREE.DoubleSide,
    flatShading: true,
  });
}

function stoneWallMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x3d352a,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
    side: THREE.DoubleSide,
  });
}

function stoneCeilingMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x2b2520,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
    flatShading: true,
  });
}

// ─── Noise-displaced geometry builders ───────────────────────────

function addFloor(group: THREE.Group, rect: Rect) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const segsX = Math.max(4, Math.round(w / (w / FLOOR_SUBDIVS)));
  const segsZ = Math.max(4, Math.round(d / (d / FLOOR_SUBDIVS)));

  const geo = new THREE.PlaneGeometry(w, d, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);

  // Displace Y with perlin noise
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + cx;
    const worldZ = pos.getZ(i) + cz;
    pos.setY(i, getCaveFloorHeight(worldX, worldZ) - FLOOR_Y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneFloorMat());
  mesh.position.set(cx, FLOOR_Y - 0.01, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addCeiling(group: THREE.Group, rect: Rect, height: number) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;

  const geo = new THREE.PlaneGeometry(w, d, FLOOR_SUBDIVS, FLOOR_SUBDIVS);
  geo.rotateX(Math.PI / 2);

  // Displace Y downward with noise (stalactite-like bumps)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + cx;
    const worldZ = pos.getZ(i) + cz;
    const n = perlin2(worldX * FLOOR_NOISE_SCALE * 1.5 + 300, worldZ * FLOOR_NOISE_SCALE * 1.5 + 300);
    pos.setY(i, pos.getY(i) - Math.abs(n) * FLOOR_NOISE_AMP * 1.5);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneCeilingMat());
  mesh.position.set(cx, FLOOR_Y + height, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Create a wall box with noise displacement on the outward-facing vertices */
function addDisplacedWallBox(
  group: THREE.Group,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  outwardAxis: 'x' | 'z',
  outwardSign: number,
) {
  const segsX = outwardAxis === 'z' ? Math.max(2, Math.round(sx)) : WALL_SUBDIVS;
  const segsY = WALL_SUBDIVS;
  const segsZ = outwardAxis === 'x' ? Math.max(2, Math.round(sz)) : WALL_SUBDIVS;

  const geo = new THREE.BoxGeometry(sx, sy, sz, segsX, segsY, segsZ);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);

    // Only displace vertices on the inward face (facing the room interior)
    const isInwardFace = outwardAxis === 'x'
      ? lx * outwardSign < 0  // inward = opposite of outward
      : lz * outwardSign < 0;

    if (isInwardFace) {
      const worldX = lx + cx;
      const worldY = ly + cy;
      const worldZ = lz + cz;
      const n = perlin2(
        (outwardAxis === 'x' ? worldZ : worldX) * WALL_NOISE_SCALE + 100,
        worldY * WALL_NOISE_SCALE + 100,
      );
      if (outwardAxis === 'x') {
        pos.setX(i, lx - n * WALL_NOISE_AMP * outwardSign);
      } else {
        pos.setZ(i, lz - n * WALL_NOISE_AMP * outwardSign);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneWallMat());
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ─── Wall builder with automatic door openings ───────────────────

function getOpeningsOnEdge(
  edgeAxis: 'x' | 'z',
  edgePos: number,
  rangeMin: number,
  rangeMax: number,
): { min: number; max: number }[] {
  const openings: { min: number; max: number }[] = [];
  for (const c of CORRIDORS) {
    if (edgeAxis === 'x') {
      if (c.z1 <= edgePos && c.z2 >= edgePos) {
        const oMin = Math.max(c.x1, rangeMin);
        const oMax = Math.min(c.x2, rangeMax);
        if (oMax > oMin) openings.push({ min: oMin, max: oMax });
      }
    } else {
      if (c.x1 <= edgePos && c.x2 >= edgePos) {
        const oMin = Math.max(c.z1, rangeMin);
        const oMax = Math.min(c.z2, rangeMax);
        if (oMax > oMin) openings.push({ min: oMin, max: oMax });
      }
    }
  }
  return openings.sort((a, b) => a.min - b.min);
}

function buildWallSegments(
  group: THREE.Group,
  edgeAxis: 'x' | 'z',
  edgePos: number,
  rangeMin: number,
  rangeMax: number,
  height: number,
  outwardSign: number,
) {
  const openings = getOpeningsOnEdge(edgeAxis, edgePos, rangeMin, rangeMax);
  const segments: { start: number; end: number }[] = [];
  let cursor = rangeMin;
  for (const op of openings) {
    if (op.min - cursor > 0.1) segments.push({ start: cursor, end: op.min });
    cursor = op.max;
  }
  if (rangeMax - cursor > 0.1) segments.push({ start: cursor, end: rangeMax });

  for (const seg of segments) {
    const len = seg.end - seg.start;
    const mid = (seg.start + seg.end) / 2;
    if (edgeAxis === 'x') {
      addDisplacedWallBox(group, mid, FLOOR_Y + height / 2, edgePos, len, height, WALL_THICKNESS, 'z', outwardSign);
    } else {
      addDisplacedWallBox(group, edgePos, FLOOR_Y + height / 2, mid, WALL_THICKNESS, height, len, 'x', outwardSign);
    }
  }
}

function addRoomWalls(group: THREE.Group, rect: Rect, height: number) {
  buildWallSegments(group, 'x', rect.z1, rect.x1, rect.x2, height, -1); // North
  buildWallSegments(group, 'x', rect.z2, rect.x1, rect.x2, height, 1);  // South
  buildWallSegments(group, 'z', rect.x1, rect.z1, rect.z2, height, -1); // West
  buildWallSegments(group, 'z', rect.x2, rect.z1, rect.z2, height, 1);  // East
}

function addCorridorWalls(group: THREE.Group, rect: Rect, height: number) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;

  if (w > d) {
    addDisplacedWallBox(group, (rect.x1 + rect.x2) / 2, FLOOR_Y + height / 2, rect.z1, w, height, WALL_THICKNESS, 'z', -1);
    addDisplacedWallBox(group, (rect.x1 + rect.x2) / 2, FLOOR_Y + height / 2, rect.z2, w, height, WALL_THICKNESS, 'z', 1);
  } else {
    addDisplacedWallBox(group, rect.x1, FLOOR_Y + height / 2, (rect.z1 + rect.z2) / 2, WALL_THICKNESS, height, d, 'x', -1);
    addDisplacedWallBox(group, rect.x2, FLOOR_Y + height / 2, (rect.z1 + rect.z2) / 2, WALL_THICKNESS, height, d, 'x', 1);
  }
}

// ─── Wall-mounted lanterns ───────────────────────────────────────

function addWallLantern(group: THREE.Group, x: number, z: number) {
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.7 });
  const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), bracketMat);
  bracket.rotation.z = Math.PI / 2;
  bracket.position.set(x, FLOOR_Y + 4.5, z);
  group.add(bracket);

  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xff9922,
    emissiveIntensity: 2.8,
    roughness: 0.35,
    metalness: 0.1,
  });
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), lanternMat);
  lantern.position.set(x, FLOOR_Y + 4.5, z);
  group.add(lantern);

  const light = new THREE.PointLight(0xffaa44, 6, 30, 1.6);
  light.position.set(x, FLOOR_Y + 5, z);
  group.add(light);
}

// ─── Room decorations ────────────────────────────────────────────

function decorateRoom(group: THREE.Group, rect: Rect) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const inset = 2;

  addWallLantern(group, cx - 8, rect.z1 + inset);
  addWallLantern(group, cx + 8, rect.z1 + inset);
  addWallLantern(group, cx - 8, rect.z2 - inset);
  addWallLantern(group, cx + 8, rect.z2 - inset);
  addWallLantern(group, rect.x1 + inset, cz - 6);
  addWallLantern(group, rect.x1 + inset, cz + 6);
  addWallLantern(group, rect.x2 - inset, cz - 6);
  addWallLantern(group, rect.x2 - inset, cz + 6);
}

function decorateCorridor(group: THREE.Group, rect: Rect) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  addWallLantern(group, cx, cz);
}

// ─── Global lighting ─────────────────────────────────────────────
function addCaveLighting(group: THREE.Group) {
  const hemi = new THREE.HemisphereLight(0xd8cfc0, 0x4a3e30, 1.0);
  hemi.position.set(0, 20, 0);
  group.add(hemi);

  const ambient = new THREE.AmbientLight(0x8a7d6a, 0.8);
  group.add(ambient);
}

// ─── Main export ─────────────────────────────────────────────────
export function createCaveScene(): THREE.Group {
  const cave = new THREE.Group();
  cave.name = 'cave_world';

  const corridorHeight = WALL_HEIGHT * 0.8;

  for (const room of ROOMS) {
    addFloor(cave, room);
    addCeiling(cave, room, WALL_HEIGHT);
    addRoomWalls(cave, room, WALL_HEIGHT);
    decorateRoom(cave, room);
  }

  for (const corridor of CORRIDORS) {
    addFloor(cave, corridor);
    addCeiling(cave, corridor, corridorHeight);
    addCorridorWalls(cave, corridor, corridorHeight);
    decorateCorridor(cave, corridor);
  }

  addCaveLighting(cave);

  return cave;
}
