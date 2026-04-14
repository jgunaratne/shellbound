import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainHeight } from './Terrain';
import pineTreeUrl from '../assets/models/pine_tree.glb';
import treeUrl from '../assets/models/tree.glb';
import rockUrl from '../assets/models/rock.glb';

type Collider = { x: number; z: number; radius: number };
const ENVIRONMENT_SPREAD = 130;
const ROCK_COUNT = 60;
const TREE_COUNT = 300;
const WATER_LEVEL = -1.9;
const TREE_CLEAR_RADIUS = 60;
const TALL_TREE_CHANCE = 0.2;

export const colliders: Collider[] = [];

function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function populateEnvironment(scene: THREE.Scene) {
  const random = createSeededRandom(42);
  const loader = new GLTFLoader();

  Promise.all([
    loader.loadAsync(pineTreeUrl),
    loader.loadAsync(treeUrl),
    loader.loadAsync(rockUrl),
  ])
    .then(([pineTree, tree, rock]) => {
      const treeModels = [pineTree.scene, tree.scene];
      const baseRock = rock.scene;

      enableShadows([...treeModels, baseRock]);
      scatterRocks(scene, baseRock, random);
      scatterTrees(scene, treeModels, random);

      console.log('Trees and rocks loaded and scattered');
    })
    .catch((error) => {
      console.error('Failed to load GLB assets:', error);
    });
}

function enableShadows(models: THREE.Object3D[]) {
  for (const model of models) {
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }
}

function scatterRocks(
  scene: THREE.Scene,
  baseRock: THREE.Object3D,
  random: () => number,
) {
  for (let i = 0; i < ROCK_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);
    const terrainY = getTerrainHeight(x, z);

    if (terrainY < WATER_LEVEL) {
      continue;
    }

    const rock = baseRock.clone();
    const scale = 0.4 + random() * 1.2;
    rock.position.set(x, terrainY - scale * 1.8, z);
    rock.scale.setScalar(scale);
    rock.rotation.y = random() * Math.PI * 2;

    colliders.push({ x, z, radius: scale * 0.8 });
    scene.add(rock);
  }
}

function scatterTrees(
  scene: THREE.Scene,
  treeModels: THREE.Object3D[],
  random: () => number,
) {
  for (let i = 0; i < TREE_COUNT; i++) {
    const x = randomWorldCoordinate(random);
    const z = randomWorldCoordinate(random);

    if (Math.hypot(x, z) < TREE_CLEAR_RADIUS) {
      continue;
    }

    const terrainY = getTerrainHeight(x, z);
    if (terrainY < WATER_LEVEL) {
      continue;
    }

    const tree = treeModels[Math.floor(random() * treeModels.length)].clone();
    const scale = getTreeScale(random);
    tree.position.set(x, terrainY - 1.8 * scale, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = random() * Math.PI * 2;

    colliders.push({ x, z, radius: 0.4 * scale });
    scene.add(tree);
  }
}

function randomWorldCoordinate(random: () => number): number {
  return (random() - 0.5) * ENVIRONMENT_SPREAD * 2;
}

function getTreeScale(random: () => number): number {
  if (random() < TALL_TREE_CHANCE) {
    return 2.5 + random() * 2.0;
  }

  return 0.6 + random() * 1.4;
}
