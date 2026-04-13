import * as THREE from 'three';
import { getTerrainHeight } from './terrain';

const rng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import pineTreeUrl from '../assets/pine_tree.glb';
import treeUrl from '../assets/tree.glb';
import rockUrl from '../assets/rock.glb';

// Simple 2D circular collision registry to prevent clipping through static objects
export const colliders: { x: number; z: number; radius: number }[] = [];

export function populateEnvironment(scene: THREE.Scene) {
  const rand = rng(42);
  const SPREAD = 130;

  // Load high-quality assets asynchronously
  const loader = new GLTFLoader();
  
  Promise.all([
    new Promise<any>((resolve, reject) => loader.load(pineTreeUrl, resolve, undefined, reject)),
    new Promise<any>((resolve, reject) => loader.load(treeUrl, resolve, undefined, reject)),
    new Promise<any>((resolve, reject) => loader.load(rockUrl, resolve, undefined, reject))
  ]).then(([pineGltf, normalGltf, rockGltf]) => {
    const treeModels = [pineGltf.scene, normalGltf.scene];
    const baseRock = rockGltf.scene;

    // Enable shadows on the base models
    [...treeModels, baseRock].forEach(model => {
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    });

    // Scatter 60 high-quality rocks
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * SPREAD * 2;
      const z = (rand() - 0.5) * SPREAD * 2;
      
      const rock = baseRock.clone();
      const scale = 0.4 + rand() * 1.2;
      
      // Sink slightly into terrain to avoid floating edges on slopes
      rock.position.set(x, getTerrainHeight(x, z) - scale * 0.1, z);
      rock.scale.setScalar(scale);
      rock.rotation.y = rand() * Math.PI * 2;
      
      // Register rock collision boundary
      colliders.push({ x, z, radius: scale * 0.8 });
      
      scene.add(rock);
    }

    // Scatter 300 clones across the terrain for a much denser forest
    for (let i = 0; i < 300; i++) {
      const x = (rand() - 0.5) * SPREAD * 2;
      const z = (rand() - 0.5) * SPREAD * 2;
      const dist = Math.sqrt(x * x + z * z);
      if (dist < 10) continue; // keep spawn area clear

      // Randomly pick one of the tree models
      const baseTree = treeModels[Math.floor(rand() * treeModels.length)];
      const tree = baseTree.clone();
      
      // Preserve perfect geometric aspect ratio using uniform scaling for natural variety
      const uniformScale = 0.6 + rand() * 1.4; // 0.6x to 2.0x uniform size
      
      // Submerge the base deeply into the ground so no part of the flat bottom is visible on sloped terrain
      const y = getTerrainHeight(x, z) - 1.8 * uniformScale;
      tree.position.set(x, y, z);
      tree.scale.setScalar(uniformScale);
      
      // Natural trunk rotation
      tree.rotation.y = rand() * Math.PI * 2;
      
      // Register solid trunk proportional to its uniform scale
      colliders.push({ x, z, radius: 0.4 * uniformScale });

      scene.add(tree);
    }
    console.log('Trees and rocks loaded and scattered');
  }).catch(err => {
    console.error('Failed to load GLB assets:', err);
  });
}
