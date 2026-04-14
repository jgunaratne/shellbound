import * as THREE from 'three';

// ─── Layout Types ────────────────────────────────────────────────
type DungeonRoom = {
  id: string;
  cx: number;
  cz: number;
  width: number;
  depth: number;
  ceilingHeight: number;
};

type DungeonCorridor = {
  fromRoom: string;
  toRoom: string;
  axis: 'x' | 'z';
  width: number;
};

// ─── Dungeon Layout ──────────────────────────────────────────────
const FLOOR_Y = 0;
const WALL_THICKNESS = 2.0;
const CORRIDOR_HEIGHT = 7;

export const CAVE_SPAWN = new THREE.Vector3(0, FLOOR_Y, 0);

const ROOMS: DungeonRoom[] = [
  { id: 'hub',   cx: 0,   cz: 0,   width: 24, depth: 24, ceilingHeight: 12 },
  { id: 'east',  cx: 40,  cz: 0,   width: 20, depth: 18, ceilingHeight: 10 },
  { id: 'north', cx: 0,   cz: -40, width: 18, depth: 20, ceilingHeight: 10 },
  { id: 'west',  cx: -40, cz: 0,   width: 20, depth: 18, ceilingHeight: 10 },
  { id: 'south', cx: 0,   cz: 40,  width: 18, depth: 20, ceilingHeight: 10 },
];

const CORRIDORS: DungeonCorridor[] = [
  { fromRoom: 'hub', toRoom: 'east',  axis: 'x', width: 6 },
  { fromRoom: 'hub', toRoom: 'north', axis: 'z', width: 6 },
  { fromRoom: 'hub', toRoom: 'west',  axis: 'x', width: 6 },
  { fromRoom: 'hub', toRoom: 'south', axis: 'z', width: 6 },
];

// ─── Computed bounds ─────────────────────────────────────────────
function computeBounds() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of ROOMS) {
    minX = Math.min(minX, r.cx - r.width / 2);
    maxX = Math.max(maxX, r.cx + r.width / 2);
    minZ = Math.min(minZ, r.cz - r.depth / 2);
    maxZ = Math.max(maxZ, r.cz + r.depth / 2);
  }
  return { minX: minX - 2, maxX: maxX + 2, minZ: minZ - 2, maxZ: maxZ + 2 };
}

export const CAVE_BOUNDS = computeBounds();

// ─── Resolve a corridor's geometric span ─────────────────────────
function resolveCorridorRect(c: DungeonCorridor) {
  const from = ROOMS.find(r => r.id === c.fromRoom)!;
  const to = ROOMS.find(r => r.id === c.toRoom)!;

  if (c.axis === 'x') {
    const x1 = Math.min(from.cx + from.width / 2, to.cx - to.width / 2);
    const x2 = Math.max(from.cx + from.width / 2, to.cx - to.width / 2);
    const midZ = (from.cz + to.cz) / 2;
    return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), z1: midZ - c.width / 2, z2: midZ + c.width / 2 };
  } else {
    const z1 = Math.min(from.cz + from.depth / 2, to.cz - to.depth / 2);
    const z2 = Math.max(from.cz + from.depth / 2, to.cz - to.depth / 2);
    const midX = (from.cx + to.cx) / 2;
    return { x1: midX - c.width / 2, x2: midX + c.width / 2, z1: Math.min(z1, z2), z2: Math.max(z1, z2) };
  }
}

// ─── Walkability ─────────────────────────────────────────────────
export function isInsideCaveLayout(x: number, z: number): boolean {
  const margin = 0.6;

  for (const r of ROOMS) {
    const hw = r.width / 2 - margin;
    const hd = r.depth / 2 - margin;
    if (Math.abs(x - r.cx) <= hw && Math.abs(z - r.cz) <= hd) return true;
  }

  for (const c of CORRIDORS) {
    const rect = resolveCorridorRect(c);
    if (x >= rect.x1 + margin && x <= rect.x2 - margin &&
        z >= rect.z1 + margin && z <= rect.z2 - margin) return true;
  }

  return false;
}

// ─── Materials ───────────────────────────────────────────────────
function floorMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x5a4e3e,
    roughness: 0.95,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
}

function wallMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x3e3529,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
    side: THREE.DoubleSide,
  });
}

function ceilingMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x2e2820,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

function pillarMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x6b5e4c,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: true,
  });
}

// ─── Geometry builders ───────────────────────────────────────────
function addFloor(group: THREE.Group, cx: number, cz: number, w: number, d: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMaterial());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, FLOOR_Y - 0.01, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addCeiling(group: THREE.Group, cx: number, cz: number, w: number, d: number, h: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilingMaterial());
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(cx, FLOOR_Y + h, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addWall(group: THREE.Group, x: number, z: number, w: number, h: number, rotY: number) {
  const geo = new THREE.BoxGeometry(w, h, WALL_THICKNESS);
  const mesh = new THREE.Mesh(geo, wallMaterial());
  mesh.position.set(x, FLOOR_Y + h / 2, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ─── Openings tracking (so walls know where doors go) ────────────
type Opening = { wallSide: 'north' | 'south' | 'east' | 'west'; min: number; max: number };

function getOpenings(room: DungeonRoom): Opening[] {
  const openings: Opening[] = [];
  for (const c of CORRIDORS) {
    const from = ROOMS.find(r => r.id === c.fromRoom)!;
    const to = ROOMS.find(r => r.id === c.toRoom)!;
    if (room.id !== c.fromRoom && room.id !== c.toRoom) continue;

    const rect = resolveCorridorRect(c);

    if (c.axis === 'x') {
      // corridor runs along X, opening is on east or west wall
      if (room.cx < (from.cx + to.cx) / 2) {
        // opening on the east wall of this room
        openings.push({ wallSide: 'east', min: rect.z1, max: rect.z2 });
      } else {
        openings.push({ wallSide: 'west', min: rect.z1, max: rect.z2 });
      }
    } else {
      if (room.cz < (from.cz + to.cz) / 2) {
        openings.push({ wallSide: 'south', min: rect.x1, max: rect.x2 });
      } else {
        openings.push({ wallSide: 'north', min: rect.x1, max: rect.x2 });
      }
    }
  }
  return openings;
}

function addRoomWalls(group: THREE.Group, room: DungeonRoom) {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const h = room.ceilingHeight;
  const openings = getOpenings(room);

  // Build each of the 4 walls, splitting around openings
  const sides: { side: 'north' | 'south' | 'east' | 'west'; axis: 'x' | 'z'; pos: number; length: number; roomCenter: number }[] = [
    { side: 'north', axis: 'x', pos: room.cz - hd, length: room.width, roomCenter: room.cx },
    { side: 'south', axis: 'x', pos: room.cz + hd, length: room.width, roomCenter: room.cx },
    { side: 'east',  axis: 'z', pos: room.cx + hw, length: room.depth, roomCenter: room.cz },
    { side: 'west',  axis: 'z', pos: room.cx - hw, length: room.depth, roomCenter: room.cz },
  ];

  for (const s of sides) {
    const wallOpenings = openings.filter(o => o.wallSide === s.side);
    const wallStart = s.roomCenter - s.length / 2;
    const wallEnd = s.roomCenter + s.length / 2;

    if (wallOpenings.length === 0) {
      // Solid wall
      if (s.axis === 'x') {
        addWall(group, room.cx, s.pos, room.width, h, 0);
      } else {
        addWall(group, s.pos, room.cz, room.depth, h, Math.PI / 2);
      }
    } else {
      // Split wall around openings
      const sorted = wallOpenings.sort((a, b) => a.min - b.min);
      let cursor = wallStart;
      for (const op of sorted) {
        const segLen = op.min - cursor;
        if (segLen > 0.5) {
          const mid = (cursor + op.min) / 2;
          if (s.axis === 'x') {
            addWall(group, mid, s.pos, segLen, h, 0);
          } else {
            addWall(group, s.pos, mid, segLen, h, Math.PI / 2);
          }
        }
        cursor = op.max;
      }
      const tailLen = wallEnd - cursor;
      if (tailLen > 0.5) {
        const mid = (cursor + wallEnd) / 2;
        if (s.axis === 'x') {
          addWall(group, mid, s.pos, tailLen, h, 0);
        } else {
          addWall(group, s.pos, mid, tailLen, h, Math.PI / 2);
        }
      }
    }
  }
}

// ─── Room detail decoration ──────────────────────────────────────
function addPillar(group: THREE.Group, x: number, z: number, height: number) {
  const radius = 0.6;
  const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 8);
  const mesh = new THREE.Mesh(geo, pillarMaterial());
  mesh.position.set(x, FLOOR_Y + height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Pillar cap
  const capGeo = new THREE.CylinderGeometry(radius * 1.5, radius * 1.3, 0.4, 8);
  const cap = new THREE.Mesh(capGeo, pillarMaterial());
  cap.position.set(x, FLOOR_Y + height, z);
  cap.castShadow = true;
  group.add(cap);

  // Pillar base
  const base = new THREE.Mesh(capGeo, pillarMaterial());
  base.position.set(x, FLOOR_Y + 0.2, z);
  group.add(base);
}

function addTorch(group: THREE.Group, x: number, z: number, height: number) {
  // Bracket
  const bracketGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6);
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.6 });
  const bracket = new THREE.Mesh(bracketGeo, bracketMat);
  bracket.position.set(x, FLOOR_Y + height, z);
  group.add(bracket);

  // Flame glow orb
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffa040,
    emissive: 0xff8020,
    emissiveIntensity: 3.0,
    roughness: 0.3,
  });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), flameMat);
  flame.position.set(x, FLOOR_Y + height + 0.9, z);
  group.add(flame);

  // Point light
  const light = new THREE.PointLight(0xffaa44, 6, 20, 1.8);
  light.position.set(x, FLOOR_Y + height + 1.2, z);
  light.castShadow = false; // limit shadow map count
  group.add(light);
}

function decorateRoom(group: THREE.Group, room: DungeonRoom) {
  const hw = room.width / 2;
  const hd = room.depth / 2;

  if (room.id === 'hub') {
    // 4 pillars in the hub room
    const inset = 4;
    addPillar(group, room.cx - hw + inset, room.cz - hd + inset, room.ceilingHeight);
    addPillar(group, room.cx + hw - inset, room.cz - hd + inset, room.ceilingHeight);
    addPillar(group, room.cx - hw + inset, room.cz + hd - inset, room.ceilingHeight);
    addPillar(group, room.cx + hw - inset, room.cz + hd - inset, room.ceilingHeight);

    // Center torch cluster
    addTorch(group, room.cx - 1.5, room.cz - 1.5, 2.5);
    addTorch(group, room.cx + 1.5, room.cz + 1.5, 2.5);
  } else {
    // 2 pillars per side room
    const inset = 3;
    addPillar(group, room.cx - hw + inset, room.cz, room.ceilingHeight);
    addPillar(group, room.cx + hw - inset, room.cz, room.ceilingHeight);

    // Torch on far wall
    addTorch(group, room.cx, room.cz, 2.5);
  }

  // Wall-mounted torches near corners
  const torchInset = 1.5;
  addTorch(group, room.cx - hw + torchInset, room.cz - hd + torchInset, 3.5);
  addTorch(group, room.cx + hw - torchInset, room.cz + hd - torchInset, 3.5);
}

function addCorridorGeometry(group: THREE.Group, corridor: DungeonCorridor) {
  const rect = resolveCorridorRect(corridor);
  const w = rect.x2 - rect.x1;
  const d = rect.z2 - rect.z1;
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;

  addFloor(group, cx, cz, w, d);
  addCeiling(group, cx, cz, w, d, CORRIDOR_HEIGHT);

  // Side walls of corridor
  if (corridor.axis === 'x') {
    // walls along Z boundaries
    addWall(group, cx, rect.z1, w, CORRIDOR_HEIGHT, 0);
    addWall(group, cx, rect.z2, w, CORRIDOR_HEIGHT, 0);
  } else {
    // walls along X boundaries
    addWall(group, rect.x1, cz, d, CORRIDOR_HEIGHT, Math.PI / 2);
    addWall(group, rect.x2, cz, d, CORRIDOR_HEIGHT, Math.PI / 2);
  }

  // Midpoint torch
  addTorch(group, cx, cz, 2.5);
}

// ─── Global cave lighting ────────────────────────────────────────
function addGlobalLighting(group: THREE.Group) {
  const broadFill = new THREE.HemisphereLight(0xd8cfc0, 0x4a3e30, 1.4);
  broadFill.position.set(0, 20, 0);
  group.add(broadFill);

  // Ambient to ensure nothing is pitch black
  const ambient = new THREE.AmbientLight(0x8a7d6a, 0.6);
  group.add(ambient);
}

// ─── Main export ─────────────────────────────────────────────────
export function createCaveScene(): THREE.Group {
  const cave = new THREE.Group();
  cave.name = 'cave_world';

  // Build rooms
  for (const room of ROOMS) {
    addFloor(cave, room.cx, room.cz, room.width, room.depth);
    addCeiling(cave, room.cx, room.cz, room.width, room.depth, room.ceilingHeight);
    addRoomWalls(cave, room);
    decorateRoom(cave, room);
  }

  // Build corridors
  for (const corridor of CORRIDORS) {
    addCorridorGeometry(cave, corridor);
  }

  addGlobalLighting(cave);

  return cave;
}
