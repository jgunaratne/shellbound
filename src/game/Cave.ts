import * as THREE from 'three';

// ─── Layout ──────────────────────────────────────────────────────
//
// The dungeon is defined as axis-aligned rectangles for rooms and
// corridors. Walkability is checked against these rects with an
// inset margin so the player can never clip into wall geometry.

type Rect = { x1: number; z1: number; x2: number; z2: number };

const FLOOR_Y = 0;
const WALL_HEIGHT = 10;
const WALL_THICKNESS = 3;
const PLAYER_MARGIN = 1.8; // walkability inset so turtle stays clear of walls

export const CAVE_SPAWN = new THREE.Vector3(0, FLOOR_Y, 0);

// ── Rooms ────────────────────────────────────────────────────────
// All coordinates are world-space (x, z). Rooms are large enough
// for comfortable navigation.
const ROOMS: Rect[] = [
  // Hub – large central cavern
  { x1: -20, z1: -20, x2: 20, z2: 20 },
  // East chamber
  { x1: 50, z1: -18, x2: 90, z2: 18 },
  // North chamber
  { x1: -18, z1: -80, x2: 18, z2: -50 },
  // West chamber
  { x1: -90, z1: -18, x2: -50, z2: 18 },
  // South chamber
  { x1: -18, z1: 50, x2: 18, z2: 80 },
];

// ── Corridors ────────────────────────────────────────────────────
const CORRIDORS: Rect[] = [
  // Hub → East
  { x1: 20, z1: -5, x2: 50, z2: 5 },
  // Hub → North
  { x1: -5, z1: -50, x2: 5, z2: -20 },
  // Hub → West
  { x1: -50, z1: -5, x2: -20, z2: 5 },
  // Hub → South
  { x1: -5, z1: 20, x2: 5, z2: 50 },
];

const ALL_WALKABLE: Rect[] = [...ROOMS, ...CORRIDORS];

// ── Exported bounds (outer AABB for Player.clampToWorld) ─────────
export const CAVE_BOUNDS = {
  minX: -92,
  maxX: 92,
  minZ: -82,
  maxZ: 82,
};

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
  });
}

function pillarMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x6b5e4c,
    roughness: 0.82,
    metalness: 0.12,
    flatShading: true,
  });
}

// ─── Geometry helpers ────────────────────────────────────────────

function addBox(
  group: THREE.Group,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  mat: THREE.Material,
  castShadow = true,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addFloor(group: THREE.Group, rect: Rect) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stoneFloorMat());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, FLOOR_Y - 0.01, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addCeiling(group: THREE.Group, rect: Rect, height: number) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stoneCeilingMat());
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(cx, FLOOR_Y + height, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ─── Wall builder with automatic door openings ───────────────────

/** Check if a wall segment along an axis overlaps with any corridor opening */
function getOpeningsOnEdge(
  edgeAxis: 'x' | 'z',
  edgePos: number,
  rangeMin: number,
  rangeMax: number,
): { min: number; max: number }[] {
  const openings: { min: number; max: number }[] = [];
  const tolerance = 0.5;

  for (const c of CORRIDORS) {
    if (edgeAxis === 'x') {
      // wall runs along X, check if corridor crosses at this Z position
      if (Math.abs(c.z1 - edgePos) < tolerance || Math.abs(c.z2 - edgePos) < tolerance) {
        const oMin = Math.max(c.x1, rangeMin);
        const oMax = Math.min(c.x2, rangeMax);
        if (oMax > oMin) openings.push({ min: oMin, max: oMax });
      }
    } else {
      // wall runs along Z, check if corridor crosses at this X position
      if (Math.abs(c.x1 - edgePos) < tolerance || Math.abs(c.x2 - edgePos) < tolerance) {
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
) {
  const openings = getOpeningsOnEdge(edgeAxis, edgePos, rangeMin, rangeMax);
  const mat = stoneWallMat();

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
      addBox(group, mid, FLOOR_Y + height / 2, edgePos, len, height, WALL_THICKNESS, mat);
    } else {
      addBox(group, edgePos, FLOOR_Y + height / 2, mid, WALL_THICKNESS, height, len, mat);
    }
  }
}

function addRoomWalls(group: THREE.Group, rect: Rect, height: number) {
  // North wall (z = z1)
  buildWallSegments(group, 'x', rect.z1, rect.x1, rect.x2, height);
  // South wall (z = z2)
  buildWallSegments(group, 'x', rect.z2, rect.x1, rect.x2, height);
  // West wall (x = x1)
  buildWallSegments(group, 'z', rect.x1, rect.z1, rect.z2, height);
  // East wall (x = x2)
  buildWallSegments(group, 'z', rect.x2, rect.z1, rect.z2, height);
}

function addCorridorWalls(group: THREE.Group, rect: Rect, height: number) {
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const mat = stoneWallMat();

  if (w > d) {
    // Horizontal corridor – walls on north and south
    addBox(group, (rect.x1 + rect.x2) / 2, FLOOR_Y + height / 2, rect.z1, w, height, WALL_THICKNESS, mat);
    addBox(group, (rect.x1 + rect.x2) / 2, FLOOR_Y + height / 2, rect.z2, w, height, WALL_THICKNESS, mat);
  } else {
    // Vertical corridor – walls on east and west
    addBox(group, rect.x1, FLOOR_Y + height / 2, (rect.z1 + rect.z2) / 2, WALL_THICKNESS, height, d, mat);
    addBox(group, rect.x2, FLOOR_Y + height / 2, (rect.z1 + rect.z2) / 2, WALL_THICKNESS, height, d, mat);
  }
}

// ─── Decorations ─────────────────────────────────────────────────

function addPillar(group: THREE.Group, x: number, z: number, height: number) {
  const r = 0.7;
  const mat = pillarMat();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, height, 8), mat);
  shaft.position.set(x, FLOOR_Y + height / 2, z);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  const capGeo = new THREE.CylinderGeometry(r * 1.6, r * 1.3, 0.5, 8);
  const cap = new THREE.Mesh(capGeo, mat);
  cap.position.set(x, FLOOR_Y + height, z);
  group.add(cap);
  const base = new THREE.Mesh(capGeo, mat);
  base.position.set(x, FLOOR_Y + 0.25, z);
  group.add(base);
}

function addTorch(group: THREE.Group, x: number, z: number) {
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffa040,
    emissive: 0xff8020,
    emissiveIntensity: 3.5,
    roughness: 0.3,
  });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), flameMat);
  flame.position.set(x, FLOOR_Y + 3.5, z);
  group.add(flame);

  const light = new THREE.PointLight(0xffaa44, 8, 35, 1.6);
  light.position.set(x, FLOOR_Y + 4, z);
  group.add(light);
}

function decorateHub(group: THREE.Group, rect: Rect) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const inset = 6;

  // Corner pillars
  addPillar(group, rect.x1 + inset, rect.z1 + inset, WALL_HEIGHT);
  addPillar(group, rect.x2 - inset, rect.z1 + inset, WALL_HEIGHT);
  addPillar(group, rect.x1 + inset, rect.z2 - inset, WALL_HEIGHT);
  addPillar(group, rect.x2 - inset, rect.z2 - inset, WALL_HEIGHT);

  // Central fire pit
  addTorch(group, cx - 2, cz - 2);
  addTorch(group, cx + 2, cz + 2);
  addTorch(group, cx - 2, cz + 2);
  addTorch(group, cx + 2, cz - 2);

  // Wall torches
  addTorch(group, rect.x1 + 3, cz);
  addTorch(group, rect.x2 - 3, cz);
  addTorch(group, cx, rect.z1 + 3);
  addTorch(group, cx, rect.z2 - 3);
}

function decorateSideRoom(group: THREE.Group, rect: Rect) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const inset = 5;

  // Two pillars
  addPillar(group, rect.x1 + inset, cz, WALL_HEIGHT);
  addPillar(group, rect.x2 - inset, cz, WALL_HEIGHT);

  // Torches along walls
  addTorch(group, rect.x1 + 3, rect.z1 + 3);
  addTorch(group, rect.x2 - 3, rect.z2 - 3);
  addTorch(group, cx, cz);
}

function decorateCorridor(group: THREE.Group, rect: Rect) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  addTorch(group, cx, cz);
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

  // Rooms
  for (let i = 0; i < ROOMS.length; i++) {
    const room = ROOMS[i];
    addFloor(cave, room);
    addCeiling(cave, room, WALL_HEIGHT);
    addRoomWalls(cave, room, WALL_HEIGHT);

    if (i === 0) {
      decorateHub(cave, room);
    } else {
      decorateSideRoom(cave, room);
    }
  }

  // Corridors
  for (const corridor of CORRIDORS) {
    addFloor(cave, corridor);
    addCeiling(cave, corridor, corridorHeight);
    addCorridorWalls(cave, corridor, corridorHeight);
    decorateCorridor(cave, corridor);
  }

  addCaveLighting(cave);

  return cave;
}
