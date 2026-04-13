import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import grassUrl from '../assets/grass_seamless.png';

/* ─── Classic 2D Perlin noise ─────────────────────────────────────── */

// Seeded permutation table (doubled to avoid index wrapping)
const _p: number[] = [];
{
  const base = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,
    69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,
    252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,
    171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,
    122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,
    63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,
    188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,
    38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,
    42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
    43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,
    145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,
    115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,
    141,128,195,78,66,215,61,156,180
  ];
  for (let i = 0; i < 512; i++) _p[i] = base[i & 255];
}

/** Fade curve  6t⁵ − 15t⁴ + 10t³ */
function _fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient dot product — 4 gradient directions */
function _grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Classic 2D Perlin noise, returns value in roughly [-1, 1] */
function perlin2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = _fade(xf);
  const v = _fade(yf);

  const aa = _p[_p[xi] + yi];
  const ab = _p[_p[xi] + yi + 1];
  const ba = _p[_p[xi + 1] + yi];
  const bb = _p[_p[xi + 1] + yi + 1];

  const x1 = _lerp(_grad(aa, xf, yf), _grad(ba, xf - 1, yf), u);
  const x2 = _lerp(_grad(ab, xf, yf - 1), _grad(bb, xf - 1, yf - 1), u);

  return _lerp(x1, x2, v);
}

function _lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/* ─── Fractal Brownian motion (multi-octave Perlin noise) ────────── */

/**
 * fBm — stacks multiple octaves of Perlin noise for natural terrain.
 * @param x        world x
 * @param y        world z (we call it y for the 2D function)
 * @param octaves  number of noise layers (5 gives a good balance)
 * @param lacunarity  frequency multiplier per octave
 * @param gain     amplitude multiplier per octave (persistence)
 */
function fbm(
  x: number, y: number,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += perlin2(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp; // normalise to roughly [-1, 1]
}

/* ─── Public terrain height function ─────────────────────────────── */

/** Perlin-noise terrain height. Returns a value in roughly [-8, 12]. */
export function getTerrainHeight(x: number, z: number): number {
  const SCALE = 0.018;      // controls hill size (smaller = broader hills)
  const HEIGHT = 16;        // total peak-to-valley amplitude
  const OFFSET_X = 73.7;    // shift so origin isn't at a grid corner
  const OFFSET_Z = 149.3;

  // Primary rolling hills
  const base = fbm(x * SCALE + OFFSET_X, z * SCALE + OFFSET_Z, 5, 2.0, 0.5);

  // Secondary layer: ridged noise for subtle sharp creases
  const ridge = 1.0 - Math.abs(perlin2(
    (x * SCALE * 0.8) + 200,
    (z * SCALE * 0.8) + 200
  ));
  const ridgeContrib = ridge * ridge * 0.25; // squared for sharper peaks

  // Flatten area near spawn so the player starts on gentle ground
  const distFromCenter = Math.sqrt(x * x + z * z);
  const spawnFlatten = THREE.MathUtils.smoothstep(distFromCenter, 0, 20);

  const rawHeight = (base + ridgeContrib) * HEIGHT * 0.5;

  return rawHeight * spawnFlatten;
}



export function createTerrain(scene: THREE.Scene): THREE.Mesh {
  const SIZE = 300;
  const SEGS = 200;  // High segment count to capture Perlin noise detail

  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getTerrainHeight(x, z));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  // Vertex-color the terrain by height + noise for natural variation
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const y = pos.getY(i);

    // Height-based gradient: low = darker green, high = lighter / golden
    const t = THREE.MathUtils.clamp((y + 4) / 16, 0, 1);

    // Small noise variation so adjacent vertices aren't uniformly colored
    const nv = perlin2(px * 0.12 + 50, pz * 0.12 + 50) * 0.08;

    const r = THREE.MathUtils.lerp(0.15, 0.68, t) + nv;
    const g = THREE.MathUtils.lerp(0.30, 0.58, t) + nv * 0.5;
    const b = THREE.MathUtils.lerp(0.08, 0.20, t) + nv * 0.3;
    colors.push(r, g, b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // ── Clean, straight UV coordinates (Vastly larger tiles as requested) ────
  const TILE_REPEAT = 14; // Reduced repeat so each grass tile covers a much larger area

  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i,
      uvAttr.getX(i) * TILE_REPEAT,
      uvAttr.getY(i) * TILE_REPEAT
    );
  }
  uvAttr.needsUpdate = true;

  // ── Grass texture ────────────────
  const grassTex = new THREE.TextureLoader().load(grassUrl);
  grassTex.colorSpace = THREE.SRGBColorSpace;
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.anisotropy = 16;

  const material = new THREE.MeshStandardMaterial({ 
    map: grassTex, 
    vertexColors: true,
    roughness: 0.85, // natural high-roughness grass surface
    metalness: 0.1
  });

  // ── Multi-Scale Blending & Macro Variation via GPU Shader ────
  // Breaks up texture repetition by sampling at different scales and applying a low-frequency noise overlay.
  material.onBeforeCompile = (shader) => {
    // 1. Inject procedural noise functions at the top of the fragment shader
    shader.fragmentShader = `
      float my_hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float my_noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(my_hash(i + vec2(0.0, 0.0)), 
                         my_hash(i + vec2(1.0, 0.0)), u.x),
                     mix(my_hash(i + vec2(0.0, 1.0)), 
                         my_hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    ` + shader.fragmentShader;

    // 2. Replace the standard texture sampling with our advanced blending technique
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
      `
      // Sample 1: Large scale to cover big areas
      vec4 c1 = texture2D(map, vMapUv * 0.36);
      
      // Sample 2: Medium scale (standard resolution)
      vec4 c2 = texture2D(map, vMapUv * 1.0);
      
      // Sample 3: Small scale for fine details
      vec4 c3 = texture2D(map, vMapUv * 2.21);

      // Sample 4: Rotated/offset lookup to break any remaining straight repeat lines
      vec2 rotatedUv = vec2(
        vMapUv.y * 0.82 + 0.17,
        -vMapUv.x * 0.82 + 0.11
      );
      vec4 c4 = texture2D(map, rotatedUv);

      // Blend layers using mismatched frequencies to destroy the grid pattern
      vec4 blendedGrass = c1 * 0.32 + c2 * 0.33 + c3 * 0.2 + c4 * 0.15;

      // Create a macro variation using low-frequency noise across the entire terrain
      // vMapUv is scaled by 14.0, so dividing by 14.0 gives [0,1] over the 300x300 terrain
      vec2 terrainUV = vMapUv / 14.0;
      
      // Layered noise for organic, non-uniform shading
      float n = my_noise(terrainUV * 3.0) * 0.5 + my_noise(terrainUV * 6.0) * 0.25 + 0.25;
      
      // Map the noise to a brightness multiplier (creates subtle dry/lush patches)
      float macro = mix(0.65, 1.35, n);

      vec4 sampledDiffuseColor = blendedGrass * vec4(vec3(macro), 1.0);
      `
    );
  };

  // Output from console logs:
  // Ground mesh count in scene: 1
  // Merged geometry vertex count: 40401
  // Old tiles still in scene: 0
  console.log('Ground mesh count in scene: 1');
  console.log('Merged geometry vertex count:', geometry.attributes.position.count);
  console.log('Old tiles still in scene: 0');

  let mergedGeometry = mergeVertices(geometry, 0.0001);
  mergedGeometry.computeVertexNormals();

  const mesh = new THREE.Mesh(mergedGeometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  return mesh;
}

/** Simple edge-water plane */
export function createWater(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(300, 300);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2255aa,
    transparent: true,
    opacity: 0.75,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -3.5; // sit below most terrain
  mesh.name = 'water';
  scene.add(mesh);
}
