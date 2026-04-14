import * as THREE from 'three';
import { perlin2 } from './Terrain';

// ─── Layout ──────────────────────────────────────────────────────
//
// Rooms are CIRCLES (natural cave chambers). Corridors are wide
// tubes connecting them. Walkability uses distance checks which
// are far more robust than axis-aligned rect checks.

type CaveRoom = {
  cx: number;
  cz: number;
  radius: number;
};

type CaveCorridor = {
  from: number; // room index
  to: number;
  halfWidth: number;
};

const FLOOR_Y = 0;
const WALL_HEIGHT = 12;
const CORRIDOR_HEIGHT = 9;
const PLAYER_MARGIN = 2.5;
const FLOOR_NOISE_SCALE = 0.12;
const FLOOR_NOISE_AMP = 0.4;
const WALL_NOISE_AMP = 0.8;
const WALL_SEGMENTS = 48;
const FLOOR_SUBDIVS = 40;

export const CAVE_SPAWN = new THREE.Vector3(0, FLOOR_Y, 0);

// ── Rooms (circular chambers) ────────────────────────────────────
export const CAVE_ROOMS: CaveRoom[] = [
  { cx: 0,    cz: 0,    radius: 30 },  // Hub
  { cx: 75,   cz: 0,    radius: 25 },  // East
  { cx: 0,    cz: -75,  radius: 25 },  // North
  { cx: -75,  cz: 0,    radius: 25 },  // West
  { cx: 0,    cz: 75,   radius: 25 },  // South
];

// ── Corridors ────────────────────────────────────────────────────
export const CAVE_CORRIDORS: CaveCorridor[] = [
  { from: 0, to: 1, halfWidth: 6 },
  { from: 0, to: 2, halfWidth: 6 },
  { from: 0, to: 3, halfWidth: 6 },
  { from: 0, to: 4, halfWidth: 6 },
];

// ── Exported bounds ──────────────────────────────────────────────
export const CAVE_BOUNDS = {
  minX: -105,
  maxX: 105,
  minZ: -105,
  maxZ: 105,
};

// ─── Cave ground height ─────────────────────────────────────────
export function getCaveFloorHeight(x: number, z: number): number {
  const n1 = perlin2(x * FLOOR_NOISE_SCALE + 200, z * FLOOR_NOISE_SCALE + 200);
  const n2 = perlin2(x * FLOOR_NOISE_SCALE * 2.3 + 50, z * FLOOR_NOISE_SCALE * 2.3 + 50);
  return FLOOR_Y + (n1 * 0.7 + n2 * 0.3) * FLOOR_NOISE_AMP;
}

// ─── Walkability ─────────────────────────────────────────────────

function distToRoom(x: number, z: number, room: CaveRoom): number {
  return Math.hypot(x - room.cx, z - room.cz);
}

/** Distance from point to the closest point on a line segment */
function distToSegment(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.001) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function isInsideCaveLayout(x: number, z: number): boolean {
  // Check rooms
  for (const room of CAVE_ROOMS) {
    if (distToRoom(x, z, room) <= room.radius - PLAYER_MARGIN) {
      return true;
    }
  }
  // Check corridors (capsule shape)
  for (const c of CAVE_CORRIDORS) {
    const a = CAVE_ROOMS[c.from];
    const b = CAVE_ROOMS[c.to];
    const dist = distToSegment(x, z, a.cx, a.cz, b.cx, b.cz);
    if (dist <= c.halfWidth - PLAYER_MARGIN) {
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

// ─── Circular room geometry ──────────────────────────────────────

function addRoomFloor(group: THREE.Group, room: CaveRoom) {
  const geo = new THREE.CircleGeometry(room.radius, WALL_SEGMENTS, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);

  // Subdivide for noise — use a higher-res circle
  const hiRes = new THREE.CircleGeometry(room.radius, WALL_SEGMENTS * 2, 0, Math.PI * 2);
  hiRes.rotateX(-Math.PI / 2);

  const pos = hiRes.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + room.cx;
    const wz = pos.getZ(i) + room.cz;
    pos.setY(i, getCaveFloorHeight(wx, wz) - FLOOR_Y);
  }
  pos.needsUpdate = true;
  hiRes.computeVertexNormals();

  const mesh = new THREE.Mesh(hiRes, stoneFloorMat());
  mesh.position.set(room.cx, FLOOR_Y - 0.01, room.cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addRoomCeiling(group: THREE.Group, room: CaveRoom) {
  const geo = new THREE.CircleGeometry(room.radius, WALL_SEGMENTS * 2);
  geo.rotateX(Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + room.cx;
    const wz = pos.getZ(i) + room.cz;
    const n = perlin2(wx * 0.18 + 300, wz * 0.18 + 300);
    pos.setY(i, pos.getY(i) - Math.abs(n) * 1.2);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneCeilingMat());
  mesh.position.set(room.cx, FLOOR_Y + WALL_HEIGHT, room.cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addRoomWalls(group: THREE.Group, room: CaveRoom) {
  // Build a cylinder wall, but remove faces where corridors connect
  const heightSegs = 8;
  const geo = new THREE.CylinderGeometry(
    room.radius, room.radius, WALL_HEIGHT, WALL_SEGMENTS, heightSegs, true,
  );

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);

    // Perlin displacement outward (push inward for cave feel)
    const angle = Math.atan2(lz, lx);
    const n = perlin2(angle * 3 + 100, ly * 0.3 + 100);
    const disp = n * WALL_NOISE_AMP;
    // Inward displacement
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    pos.setX(i, lx - nx * disp);
    pos.setZ(i, lz - nz * disp);

    // Remove wall geometry where corridors connect by pushing vertices
    // outward to make openings
    for (const c of CAVE_CORRIDORS) {
      let otherRoom: CaveRoom | null = null;
      if (c.from === CAVE_ROOMS.indexOf(room)) otherRoom = CAVE_ROOMS[c.to];
      else if (c.to === CAVE_ROOMS.indexOf(room)) otherRoom = CAVE_ROOMS[c.from];
      if (!otherRoom) continue;

      const corridorAngle = Math.atan2(otherRoom.cz - room.cz, otherRoom.cx - room.cx);
      const vertAngle = Math.atan2(lz, lx);

      // Angular width of the corridor opening
      const openingAngle = Math.atan2(c.halfWidth, room.radius) * 1.3;
      let angleDiff = vertAngle - corridorAngle;
      // Normalize to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      if (Math.abs(angleDiff) < openingAngle) {
        // Push this vertex way out so the face becomes invisible/degenerate
        pos.setX(i, lx + nx * 20);
        pos.setZ(i, lz + nz * 20);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneWallMat());
  mesh.position.set(room.cx, FLOOR_Y + WALL_HEIGHT / 2, room.cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ─── Corridor geometry ───────────────────────────────────────────

function addCorridor(group: THREE.Group, corridor: CaveCorridor) {
  const a = CAVE_ROOMS[corridor.from];
  const b = CAVE_ROOMS[corridor.to];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const cx = (a.cx + b.cx) / 2;
  const cz = (a.cz + b.cz) / 2;
  const hw = corridor.halfWidth;

  // Floor
  const floorGeo = new THREE.PlaneGeometry(hw * 2, length, 12, FLOOR_SUBDIVS);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.rotateY(angle);

  const floorPos = floorGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < floorPos.count; i++) {
    const wx = floorPos.getX(i) + cx;
    const wz = floorPos.getZ(i) + cz;
    floorPos.setY(i, getCaveFloorHeight(wx, wz) - FLOOR_Y);
  }
  floorPos.needsUpdate = true;
  floorGeo.computeVertexNormals();

  const floor = new THREE.Mesh(floorGeo, stoneFloorMat());
  floor.position.set(cx, FLOOR_Y - 0.01, cz);
  floor.receiveShadow = true;
  group.add(floor);

  // Ceiling
  const ceilGeo = new THREE.PlaneGeometry(hw * 2, length, 12, FLOOR_SUBDIVS);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.rotateY(angle);

  const ceilPos = ceilGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < ceilPos.count; i++) {
    const wx = ceilPos.getX(i) + cx;
    const wz = ceilPos.getZ(i) + cz;
    const n = perlin2(wx * 0.18 + 300, wz * 0.18 + 300);
    ceilPos.setY(i, ceilPos.getY(i) - Math.abs(n) * 0.8);
  }
  ceilPos.needsUpdate = true;
  ceilGeo.computeVertexNormals();

  const ceiling = new THREE.Mesh(ceilGeo, stoneCeilingMat());
  ceiling.position.set(cx, FLOOR_Y + CORRIDOR_HEIGHT, cz);
  ceiling.receiveShadow = true;
  group.add(ceiling);

  // Side walls (two curved planes along corridor length)
  for (const side of [-1, 1]) {
    const wallGeo = new THREE.PlaneGeometry(length, CORRIDOR_HEIGHT, FLOOR_SUBDIVS, 8);

    const wallPos = wallGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < wallPos.count; i++) {
      const n = perlin2(
        wallPos.getX(i) * 0.2 + 100 + side * 50,
        wallPos.getY(i) * 0.3 + 100,
      );
      wallPos.setZ(i, wallPos.getZ(i) + n * WALL_NOISE_AMP);
    }
    wallPos.needsUpdate = true;
    wallGeo.computeVertexNormals();

    const wall = new THREE.Mesh(wallGeo, stoneWallMat());

    // Position: offset perpendicular to corridor direction
    const perpX = -Math.sin(angle - Math.PI / 2) * hw * side;
    const perpZ = -Math.cos(angle - Math.PI / 2) * hw * side;
    wall.position.set(cx + perpX, FLOOR_Y + CORRIDOR_HEIGHT / 2, cz + perpZ);
    wall.rotation.y = angle;
    if (side === 1) wall.rotation.y += Math.PI;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }
}

// ─── Wall-mounted lanterns ───────────────────────────────────────

function addWallLantern(group: THREE.Group, x: number, z: number) {
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

  const light = new THREE.PointLight(0xffaa44, 6, 35, 1.6);
  light.position.set(x, FLOOR_Y + 5, z);
  group.add(light);
}

function decorateRoom(group: THREE.Group, room: CaveRoom) {
  // Place lanterns around the wall perimeter
  const lanternCount = room.radius > 28 ? 8 : 6;
  const inset = 2.5;
  for (let i = 0; i < lanternCount; i++) {
    const angle = (i / lanternCount) * Math.PI * 2;
    // Skip angles where corridors connect
    let skipThis = false;
    for (const c of CAVE_CORRIDORS) {
      let otherRoom: CaveRoom | null = null;
      if (c.from === CAVE_ROOMS.indexOf(room)) otherRoom = CAVE_ROOMS[c.to];
      else if (c.to === CAVE_ROOMS.indexOf(room)) otherRoom = CAVE_ROOMS[c.from];
      if (!otherRoom) continue;
      const corridorAngle = Math.atan2(otherRoom.cz - room.cz, otherRoom.cx - room.cx);
      let diff = angle - corridorAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.5) { skipThis = true; break; }
    }
    if (skipThis) continue;

    const lx = room.cx + Math.cos(angle) * (room.radius - inset);
    const lz = room.cz + Math.sin(angle) * (room.radius - inset);
    addWallLantern(group, lx, lz);
  }
}

function decorateCorridor(group: THREE.Group, corridor: CaveCorridor) {
  const a = CAVE_ROOMS[corridor.from];
  const b = CAVE_ROOMS[corridor.to];
  const cx = (a.cx + b.cx) / 2;
  const cz = (a.cz + b.cz) / 2;
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

  for (const room of CAVE_ROOMS) {
    addRoomFloor(cave, room);
    addRoomCeiling(cave, room);
    addRoomWalls(cave, room);
    decorateRoom(cave, room);
  }

  for (const corridor of CAVE_CORRIDORS) {
    addCorridor(cave, corridor);
    decorateCorridor(cave, corridor);
  }

  addCaveLighting(cave);

  return cave;
}
