import * as THREE from 'three';

export const CAVE_SPAWN = new THREE.Vector3(0, 4.5, 0);
export const CAVE_BOUNDS = {
  minX: -16,
  maxX: 16,
  minZ: -18,
  maxZ: 18,
};

const CAVE_RADIUS = 22;
const CAVE_HEIGHT = 18;

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

export function createCaveScene(floorY: number): THREE.Group {
  const cave = new THREE.Group();
  cave.name = 'cave_world';

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(CAVE_RADIUS, 32),
    new THREE.MeshStandardMaterial({
      color: 0x6a5b47,
      emissive: 0x17120e,
      side: THREE.DoubleSide,
      roughness: 0.98,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY - 0.02;
  floor.receiveShadow = true;
  cave.add(floor);

  const wallMaterial = createRockMaterial(0x4c4339);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(CAVE_RADIUS, CAVE_RADIUS + 2, CAVE_HEIGHT, 18, 5, true),
    wallMaterial,
  );
  (wall.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
  wall.position.y = floorY + CAVE_HEIGHT * 0.5 - 1;
  wall.castShadow = true;
  wall.receiveShadow = true;
  cave.add(wall);

  const ceiling = new THREE.Mesh(
    new THREE.SphereGeometry(CAVE_RADIUS * 0.92, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.2),
    createRockMaterial(0x3a342f),
  );
  (ceiling.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
  ceiling.position.y = floorY + CAVE_HEIGHT - 2;
  ceiling.scale.y = 0.65;
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  cave.add(ceiling);

  const stalagmiteGeometry = createRockGeometry(1.4, 4.8);
  const stalactiteGeometry = createRockGeometry(1.2, 5.2);
  const accentMaterial = createRockMaterial(0x7c6b59);
  const count = 12;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 13 + (i % 3) * 2.3;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const groundRock = new THREE.Mesh(stalagmiteGeometry, accentMaterial);
    groundRock.position.set(x, floorY + 1.4, z);
    groundRock.rotation.y = angle * 0.7;
    groundRock.scale.setScalar(0.8 + (i % 4) * 0.18);
    groundRock.castShadow = true;
    groundRock.receiveShadow = true;
    cave.add(groundRock);

    const ceilingRock = new THREE.Mesh(stalactiteGeometry, wallMaterial);
    ceilingRock.position.set(x * 0.75, floorY + CAVE_HEIGHT - 2.4, z * 0.75);
    ceilingRock.rotation.set(Math.PI, angle * 0.5, 0);
    ceilingRock.scale.setScalar(0.65 + (i % 5) * 0.12);
    ceilingRock.castShadow = true;
    ceilingRock.receiveShadow = true;
    cave.add(ceilingRock);
  }

  const emberGeometry = new THREE.SphereGeometry(0.45, 12, 12);
  const emberMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa14a,
    emissive: 0xff7a1a,
    emissiveIntensity: 1.8,
    roughness: 0.6,
  });
  const emberOffsets = [
    new THREE.Vector3(-4, floorY + 0.4, -3),
    new THREE.Vector3(-2.6, floorY + 0.3, -1.8),
    new THREE.Vector3(-3.2, floorY + 0.25, -4.6),
  ];

  for (const offset of emberOffsets) {
    const ember = new THREE.Mesh(emberGeometry, emberMaterial);
    ember.position.copy(offset);
    cave.add(ember);
  }

  const fireLight = new THREE.PointLight(0xffa15a, 12, 22, 1.8);
  fireLight.position.set(-3.2, floorY + 1.8, -3.2);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(1024, 1024);
  cave.add(fireLight);

  const lanternPositions = [
    new THREE.Vector3(-10, floorY + 4.6, -8),
    new THREE.Vector3(9, floorY + 5.2, -6),
    new THREE.Vector3(7, floorY + 4.4, 9),
  ];

  for (const position of lanternPositions) {
    const lantern = createLantern(0xffc56b);
    lantern.position.copy(position);
    cave.add(lantern);

    const lanternLight = new THREE.PointLight(0xffd27a, 7, 20, 2);
    lanternLight.position.copy(position);
    cave.add(lanternLight);
  }

  const overheadFill = new THREE.PointLight(0xc8d6ff, 5.5, 52, 2);
  overheadFill.position.set(0, floorY + CAVE_HEIGHT - 4, 0);
  cave.add(overheadFill);

  const broadFill = new THREE.HemisphereLight(0xd8d6cf, 0x5b4734, 1.8);
  broadFill.position.set(0, floorY + CAVE_HEIGHT, 0);
  cave.add(broadFill);

  cave.visible = false;
  return cave;
}
