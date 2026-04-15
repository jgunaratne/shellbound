import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { perlin2 } from './Terrain';
import mangoShopUrl from '../assets/models/mango_shop.glb';
import caveFloorUrl from '../assets/cave_floor.png';
import caveWallUrl from '../assets/cave_wall.png';
import caveCeilingUrl from '../assets/cave_ceiling.png';

// ─── Layout ──────────────────────────────────────────────────────
//
// Rooms are SQUARES. Corridors are wide tubes connecting them.
// Walkability uses axis-aligned bounding-box checks.

type CaveRoom = {
  cx: number;
  cz: number;
  radius: number; // half-size of the square
};

type CaveCorridor = {
  from: number; // room index
  to: number;
  halfWidth: number;
};

const FLOOR_Y = 0;
const WALL_HEIGHT = 20;
const CORRIDOR_HEIGHT = 9;
const PLAYER_MARGIN = 2.5;
const FLOOR_NOISE_SCALE = 0.12;
const FLOOR_NOISE_AMP = 1.8;
const WALL_NOISE_AMP = 2.5;
const FLOOR_SUBDIVS = 40;

export const CAVE_SPAWN = new THREE.Vector3(0, FLOOR_Y, 0);

// ── Rooms (square chambers) ──────────────────────────────────────
export const CAVE_ROOMS: CaveRoom[] = [
  { cx: 0, cz: 0, radius: 40 },  // Single large room
];

// ── Corridors ────────────────────────────────────────────────────
export const CAVE_CORRIDORS: CaveCorridor[] = [];

// ── Exported bounds ──────────────────────────────────────────────
export const CAVE_BOUNDS = {
  minX: -45,
  maxX: 45,
  minZ: -45,
  maxZ: 45,
};

// ─── Cave ground height ─────────────────────────────────────────
export function getCaveFloorHeight(x: number, z: number): number {
  const n1 = perlin2(x * FLOOR_NOISE_SCALE + 200, z * FLOOR_NOISE_SCALE + 200);
  const n2 = perlin2(x * FLOOR_NOISE_SCALE * 2.3 + 50, z * FLOOR_NOISE_SCALE * 2.3 + 50);
  return FLOOR_Y + (n1 * 0.7 + n2 * 0.3) * FLOOR_NOISE_AMP;
}

// ─── Walkability ─────────────────────────────────────────────────

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
  // Check rooms (axis-aligned square)
  for (const room of CAVE_ROOMS) {
    const hs = room.radius - PLAYER_MARGIN;
    if (Math.abs(x - room.cx) <= hs && Math.abs(z - room.cz) <= hs) {
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



// ─── Textures ────────────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();

const caveFloorTexture = textureLoader.load(caveFloorUrl);
caveFloorTexture.wrapS = THREE.RepeatWrapping;
caveFloorTexture.wrapT = THREE.RepeatWrapping;
caveFloorTexture.repeat.set(4, 4);
caveFloorTexture.colorSpace = THREE.SRGBColorSpace;

const caveWallTexture = textureLoader.load(caveWallUrl);
caveWallTexture.wrapS = THREE.RepeatWrapping;
caveWallTexture.wrapT = THREE.RepeatWrapping;
caveWallTexture.repeat.set(3, 1);
caveWallTexture.colorSpace = THREE.SRGBColorSpace;

const caveCeilingTexture = textureLoader.load(caveCeilingUrl);
caveCeilingTexture.wrapS = THREE.RepeatWrapping;
caveCeilingTexture.wrapT = THREE.RepeatWrapping;
caveCeilingTexture.repeat.set(3, 3);
caveCeilingTexture.colorSpace = THREE.SRGBColorSpace;

// ─── Materials ───────────────────────────────────────────────────
function stoneFloorMat() {
  return new THREE.MeshStandardMaterial({
    map: caveFloorTexture,
    roughness: 0.94,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
}

function stoneWallMat() {
  return new THREE.MeshStandardMaterial({
    map: caveWallTexture,
    roughness: 0.92,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
}

function stoneCeilingMat() {
  return new THREE.MeshStandardMaterial({
    map: caveCeilingTexture,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

// ─── Square room geometry ────────────────────────────────────────

function addRoomFloor(group: THREE.Group, room: CaveRoom) {
  const size = room.radius * 2;
  const geo = new THREE.PlaneGeometry(size, size, FLOOR_SUBDIVS, FLOOR_SUBDIVS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + room.cx;
    const wz = pos.getZ(i) + room.cz;
    pos.setY(i, getCaveFloorHeight(wx, wz) - FLOOR_Y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneFloorMat());
  mesh.position.set(room.cx, FLOOR_Y - 0.01, room.cz);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addRoomCeiling(group: THREE.Group, room: CaveRoom) {
  const size = room.radius * 2;
  const geo = new THREE.PlaneGeometry(size, size, FLOOR_SUBDIVS, FLOOR_SUBDIVS);
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

// ─── Square room walls ───────────────────────────────────────────

type WallFace = 'east' | 'west' | 'north' | 'south';

/** Which face of the room does a corridor exit through? */
function getCorridorFace(room: CaveRoom, otherRoom: CaveRoom): WallFace {
  const dx = otherRoom.cx - room.cx;
  const dz = otherRoom.cz - room.cz;
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? 'east' : 'west';
  }
  return dz > 0 ? 'south' : 'north';
}

function addWallSegment(
  group: THREE.Group,
  cx: number, cy: number, cz: number,
  width: number, height: number,
  rotY: number,
) {
  if (width < 0.1) return;

  const segs = Math.max(2, Math.round(width / 3));
  const geo = new THREE.PlaneGeometry(width, height, segs, 8);

  // Perlin noise displacement along local Z (wall normal)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const n = perlin2(
      pos.getX(i) * 0.2 + 100 + cx * 0.1,
      pos.getY(i) * 0.3 + 100 + cz * 0.1,
    );
    pos.setZ(i, pos.getZ(i) + n * WALL_NOISE_AMP);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stoneWallMat());
  mesh.position.set(cx, cy, cz);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addRoomWalls(group: THREE.Group, room: CaveRoom) {
  const roomIndex = CAVE_ROOMS.indexOf(room);
  const hs = room.radius;
  const wallY = FLOOR_Y + WALL_HEIGHT / 2;

  // Face definitions: which axis the wall runs along, its fixed position, and Y rotation
  // Rotations chosen so normals face INWARD
  const faceDefs: {
    face: WallFace;
    wallAxis: 'x' | 'z';
    fixedValue: number;
    rotY: number;
  }[] = [
    { face: 'east',  wallAxis: 'z', fixedValue: room.cx + hs, rotY: -Math.PI / 2 },
    { face: 'west',  wallAxis: 'z', fixedValue: room.cx - hs, rotY: Math.PI / 2 },
    { face: 'north', wallAxis: 'x', fixedValue: room.cz - hs, rotY: 0 },
    { face: 'south', wallAxis: 'x', fixedValue: room.cz + hs, rotY: Math.PI },
  ];

  for (const fd of faceDefs) {
    // Collect corridor openings on this face
    const openings: { position: number; halfWidth: number }[] = [];

    for (const c of CAVE_CORRIDORS) {
      let otherRoom: CaveRoom | null = null;
      if (c.from === roomIndex) otherRoom = CAVE_ROOMS[c.to];
      else if (c.to === roomIndex) otherRoom = CAVE_ROOMS[c.from];
      if (!otherRoom) continue;

      if (getCorridorFace(room, otherRoom) !== fd.face) continue;

      // Opening position along the wall axis (relative to room center)
      const relPos = fd.wallAxis === 'z'
        ? otherRoom.cz - room.cz
        : otherRoom.cx - room.cx;
      openings.push({ position: relPos, halfWidth: c.halfWidth });
    }

    // Sort openings along the wall
    openings.sort((a, b) => a.position - b.position);

    // Build wall segments in the gaps between openings
    let cursor = -hs;
    for (const op of openings) {
      const gapStart = op.position - op.halfWidth;
      const gapEnd = op.position + op.halfWidth;

      const segWidth = gapStart - cursor;
      if (segWidth > 0.1) {
        const segCenter = (cursor + gapStart) / 2;
        const sx = fd.wallAxis === 'z' ? fd.fixedValue : room.cx + segCenter;
        const sz = fd.wallAxis === 'z' ? room.cz + segCenter : fd.fixedValue;
        addWallSegment(group, sx, wallY, sz, segWidth, WALL_HEIGHT, fd.rotY);
      }
      cursor = gapEnd;
    }

    // Final segment after last opening
    const finalWidth = hs - cursor;
    if (finalWidth > 0.1) {
      const segCenter = (cursor + hs) / 2;
      const sx = fd.wallAxis === 'z' ? fd.fixedValue : room.cx + segCenter;
      const sz = fd.wallAxis === 'z' ? room.cz + segCenter : fd.fixedValue;
      addWallSegment(group, sx, wallY, sz, finalWidth, WALL_HEIGHT, fd.rotY);
    }
  }
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

  // Side walls (planes along corridor length)
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
    wall.rotation.y = angle - Math.PI / 2;
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
  const hs = room.radius;
  const inset = 4;

  // One lantern per corner — only 4 PointLights total
  const corners: [number, number][] = [
    [room.cx - hs + inset, room.cz - hs + inset],
    [room.cx + hs - inset, room.cz - hs + inset],
    [room.cx - hs + inset, room.cz + hs - inset],
    [room.cx + hs - inset, room.cz + hs - inset],
  ];

  for (const [lx, lz] of corners) {
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

// ─── Mango shop asset ────────────────────────────────────────────

function loadMangoShop(group: THREE.Group) {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(dracoLoader);

  // Place the shop in the room
  const room = CAVE_ROOMS[0];

  loader.loadAsync(mangoShopUrl)
    .then((gltf) => {
      const model = gltf.scene;

      // Normalise model to shop scale
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const TARGET_SIZE = 8;
      if (maxDim > 0) {
        const normScale = TARGET_SIZE / maxDim;
        model.scale.multiplyScalar(normScale);
      }

      // Rotate -90 degrees
      model.rotation.y = -Math.PI / 2;
      model.updateMatrixWorld(true);

      // Re-measure after scaling/rotation and place against the north wall
      const scaledBox = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      scaledBox.getCenter(center);
      const scaledSize = new THREE.Vector3();
      scaledBox.getSize(scaledSize);
      const wallInset = 2;
      model.position.set(
        room.cx - center.x,
        getCaveFloorHeight(room.cx, room.cz) - scaledBox.min.y,
        room.cz - room.radius + wallInset + scaledSize.z / 2 - center.z,
      );

      // Enable shadows
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      group.add(model);
      console.log('Mango shop loaded into cave (East room)');
    })
    .catch((err) => {
      console.error('Failed to load mango shop:', err);
    });
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
  loadMangoShop(cave);

  return cave;
}
