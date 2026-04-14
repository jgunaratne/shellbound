import * as THREE from 'three';

export const CAVE_SPAWN = new THREE.Vector3(0, 4.5, 0);

type CaveRoom = {
  center: THREE.Vector3;
  radius: number;
  shellHeight: number;
};

type CaveTunnel = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  width: number;
  height: number;
};

const FLOOR_Y_OFFSET = -0.02;

const CAVE_ROOMS: CaveRoom[] = [
  { center: new THREE.Vector3(0, 4.5, 0), radius: 13, shellHeight: 14 },
  { center: new THREE.Vector3(22, 4.5, -8), radius: 10, shellHeight: 12 },
  { center: new THREE.Vector3(18, 4.5, 20), radius: 11, shellHeight: 13 },
  { center: new THREE.Vector3(-20, 4.5, 14), radius: 9, shellHeight: 11 },
];

const CAVE_TUNNELS: CaveTunnel[] = [
  {
    start: CAVE_ROOMS[0].center,
    end: CAVE_ROOMS[1].center,
    width: 8,
    height: 9,
  },
  {
    start: CAVE_ROOMS[1].center,
    end: CAVE_ROOMS[2].center,
    width: 7,
    height: 8,
  },
  {
    start: CAVE_ROOMS[0].center,
    end: CAVE_ROOMS[3].center,
    width: 7,
    height: 8,
  },
];

export const CAVE_BOUNDS = {
  minX: -32,
  maxX: 32,
  minZ: -20,
  maxZ: 32,
};

function createRockGeometry(radius: number, height: number) {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i++) {
    const scale = 0.82 + Math.sin(i * 1.7) * 0.08 + Math.cos(i * 0.9) * 0.06;
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * (height / radius) * scale,
      position.getZ(i) * scale,
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createRockMaterial(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.08),
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
  });
}

function createFloorMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x6a5b47,
    emissive: 0x17120e,
    side: THREE.DoubleSide,
    roughness: 0.98,
    metalness: 0.02,
  });
}

function createLantern(color: number) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 16),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.4,
      roughness: 0.35,
      metalness: 0.05,
    }),
  );
}

function addRoom(cave: THREE.Group, room: CaveRoom) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(room.radius, 32),
    createFloorMaterial(),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.center.x, room.center.y + FLOOR_Y_OFFSET, room.center.z);
  floor.receiveShadow = true;
  cave.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(room.radius * 0.98, 32),
    createRockMaterial(0x3a342f),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(room.center.x, room.center.y + room.shellHeight, room.center.z);
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  cave.add(ceiling);

  const wallCount = 20;
  const wallMaterial = createRockMaterial(0x4c4339);
  for (let i = 0; i < wallCount; i++) {
    const angle = (i / wallCount) * Math.PI * 2;
    const wallWidth = room.radius * 0.42;
    const wallThickness = 2.4;
    const wallHeight = room.shellHeight + 1;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(wallWidth, wallHeight, wallThickness),
      wallMaterial,
    );
    wall.position.set(
      room.center.x + Math.cos(angle) * room.radius,
      room.center.y + wallHeight * 0.5,
      room.center.z + Math.sin(angle) * room.radius,
    );
    wall.rotation.y = angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    cave.add(wall);
  }
}

function addTunnel(cave: THREE.Group, tunnel: CaveTunnel) {
  const direction = new THREE.Vector3().subVectors(tunnel.end, tunnel.start);
  const length = Math.hypot(direction.x, direction.z);
  const angle = Math.atan2(direction.x, direction.z);
  const center = new THREE.Vector3().addVectors(tunnel.start, tunnel.end).multiplyScalar(0.5);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(tunnel.width, length),
    createFloorMaterial(),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.rotation.z = angle;
  floor.position.set(center.x, tunnel.start.y + FLOOR_Y_OFFSET, center.z);
  floor.receiveShadow = true;
  cave.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(tunnel.width, length),
    createRockMaterial(0x3b342e),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.rotation.z = angle;
  ceiling.position.set(center.x, tunnel.start.y + tunnel.height, center.z);
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  cave.add(ceiling);

  const wallMaterial = createRockMaterial(0x443b33);
  for (const side of [-1, 1] as const) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, tunnel.height, length),
      wallMaterial,
    );
    const offsetX = Math.cos(angle) * (tunnel.width * 0.5) * side;
    const offsetZ = -Math.sin(angle) * (tunnel.width * 0.5) * side;
    wall.position.set(
      center.x + offsetX,
      tunnel.start.y + tunnel.height * 0.5,
      center.z + offsetZ,
    );
    wall.rotation.y = angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    cave.add(wall);
  }
}

function addRoomDetails(cave: THREE.Group) {
  const stalagmiteGeometry = createRockGeometry(1.4, 4.8);
  const stalactiteGeometry = createRockGeometry(1.2, 5.2);
  const accentMaterial = createRockMaterial(0x7c6b59);
  const wallMaterial = createRockMaterial(0x4c4339);
  const detailAnchors = [
    new THREE.Vector3(-8, 4.5, -7),
    new THREE.Vector3(9, 4.5, 8),
    new THREE.Vector3(24, 4.5, -12),
    new THREE.Vector3(14, 4.5, 24),
    new THREE.Vector3(-24, 4.5, 17),
    new THREE.Vector3(-8, 4.5, 18),
  ];

  for (let i = 0; i < detailAnchors.length; i++) {
    const anchor = detailAnchors[i];

    const groundRock = new THREE.Mesh(stalagmiteGeometry, accentMaterial);
    groundRock.position.set(anchor.x, anchor.y + 1.4, anchor.z);
    groundRock.rotation.y = i * 0.6;
    groundRock.scale.setScalar(0.9 + (i % 3) * 0.2);
    groundRock.castShadow = true;
    groundRock.receiveShadow = true;
    cave.add(groundRock);

    const ceilingRock = new THREE.Mesh(stalactiteGeometry, wallMaterial);
    ceilingRock.position.set(anchor.x * 0.75, anchor.y + 9.5 + (i % 3), anchor.z * 0.75);
    ceilingRock.rotation.set(Math.PI, i * 0.5, 0);
    ceilingRock.scale.setScalar(0.75 + (i % 4) * 0.12);
    ceilingRock.castShadow = true;
    ceilingRock.receiveShadow = true;
    cave.add(ceilingRock);
  }
}

function addLighting(cave: THREE.Group) {
  const emberGeometry = new THREE.SphereGeometry(0.45, 12, 12);
  const emberMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa14a,
    emissive: 0xff7a1a,
    emissiveIntensity: 1.8,
    roughness: 0.6,
  });
  const emberOffsets = [
    new THREE.Vector3(-4, 4.9, -3),
    new THREE.Vector3(-2.6, 4.8, -1.8),
    new THREE.Vector3(-3.2, 4.75, -4.6),
  ];

  for (const offset of emberOffsets) {
    const ember = new THREE.Mesh(emberGeometry, emberMaterial);
    ember.position.copy(offset);
    cave.add(ember);
  }

  const fireLight = new THREE.PointLight(0xffa15a, 13, 26, 1.8);
  fireLight.position.set(-3.2, 6.3, -3.2);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(1024, 1024);
  cave.add(fireLight);

  const lanternPositions = [
    new THREE.Vector3(20, 10.5, -10),
    new THREE.Vector3(18, 10.5, 18),
    new THREE.Vector3(-18, 9.5, 14),
    new THREE.Vector3(5, 10, 10),
  ];

  for (const position of lanternPositions) {
    const lantern = createLantern(0xffc56b);
    lantern.position.copy(position);
    cave.add(lantern);

    const lanternLight = new THREE.PointLight(0xffd27a, 8.5, 22, 2);
    lanternLight.position.copy(position);
    cave.add(lanternLight);
  }

  const broadFill = new THREE.HemisphereLight(0xd8d6cf, 0x5b4734, 1.8);
  broadFill.position.set(0, 18, 0);
  cave.add(broadFill);
}

export function isInsideCaveLayout(x: number, z: number) {
  for (const room of CAVE_ROOMS) {
    if (Math.hypot(x - room.center.x, z - room.center.z) <= room.radius - 1.2) {
      return true;
    }
  }

  for (const tunnel of CAVE_TUNNELS) {
    const ax = tunnel.start.x;
    const az = tunnel.start.z;
    const bx = tunnel.end.x;
    const bz = tunnel.end.z;
    const abx = bx - ax;
    const abz = bz - az;
    const apx = x - ax;
    const apz = z - az;
    const abLengthSq = abx * abx + abz * abz;
    const t = THREE.MathUtils.clamp((apx * abx + apz * abz) / abLengthSq, 0, 1);
    const closestX = ax + abx * t;
    const closestZ = az + abz * t;
    if (Math.hypot(x - closestX, z - closestZ) <= tunnel.width * 0.42) {
      return true;
    }
  }

  return false;
}

export function createCaveScene(): THREE.Group {
  const cave = new THREE.Group();
  cave.name = 'cave_world';

  for (const room of CAVE_ROOMS) {
    addRoom(cave, room);
  }

  for (const tunnel of CAVE_TUNNELS) {
    addTunnel(cave, tunnel);
  }

  addRoomDetails(cave);
  addLighting(cave);

  cave.visible = false;
  return cave;
}
