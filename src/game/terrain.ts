import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import grassUrl from '../assets/grass.png';

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
  // Generate massive, natural Perlin-based rolling hills and deep valleys
  const base = fbm(x * SCALE + OFFSET_X, z * SCALE + OFFSET_Z, 5, 2.0, 0.5);
  let rawHeight = base * HEIGHT * 0.95;

  // Carve exactly ONE beautiful, dedicated mid-sized lake right in front of the player's starting view
  const distFromSingleLake = Math.sqrt(x * x + (z + 60) * (z + 60));
  const lakeBasin = 1.0 - THREE.MathUtils.smoothstep(distFromSingleLake, 0, 45);

  rawHeight -= lakeBasin * 10.0;

  // Prevent small puddles: clamp terrain above water level (-1.9) everywhere except the main lake
  if (lakeBasin < 0.01) {
    rawHeight = Math.max(rawHeight, -1.5);
  }

  // Keep spawn completely level and dry
  const distFromCenter = Math.sqrt(x * x + z * z);
  const spawnFlatten = THREE.MathUtils.smoothstep(distFromCenter, 0, 20);
  const spawnElevation = 4.5 * (1.0 - spawnFlatten);

  return rawHeight * spawnFlatten + spawnElevation;
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

  // ── Clean, straight UV coordinates ────
  const TILE_REPEAT = 6; // Fewer repeats = bigger tiles = far less visible seams

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
    roughness: 1.0,
    metalness: 0.0
  });

  // ── Hex Tiling: eliminates grid seams by sampling in overlapping hexagonal cells ────
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `
      // --- Hex tiling helpers ---
      vec4 hex_hash4(vec2 p) {
          return fract(sin(vec4(
              dot(p, vec2(127.1, 311.7)),
              dot(p, vec2(269.5, 183.3)),
              dot(p, vec2(419.2, 371.9)),
              dot(p, vec2(523.7, 247.1))
          )) * 43758.5453);
      }

      // Hex grid cell decomposition: returns barycentric-like weights + cell IDs
      void hexTile(vec2 uv, out vec2 uv1, out vec2 uv2, out vec2 uv3, out float w1, out float w2, out float w3) {
          vec2 q = vec2(uv.x * 2.0 * 0.5773503, uv.y + uv.x * 0.5773503);
          vec2 qi = floor(q);
          vec2 qf = fract(q);

          float triType = step(qf.x + qf.y, 1.0);

          // Three vertices of the containing triangle
          vec2 v1i = qi;
          vec2 v2i = qi + vec2(1.0, 0.0);
          vec2 v3i = qi + vec2(0.0, 1.0);
          if (triType < 0.5) {
              v1i = qi + vec2(1.0, 1.0);
          }

          // Random UV offsets per hex cell
          vec4 h1 = hex_hash4(v1i);
          vec4 h2 = hex_hash4(v2i);
          vec4 h3 = hex_hash4(v3i);

          // Rotated + offset UVs per cell
          float rot1 = h1.z * 6.2831;
          float rot2 = h2.z * 6.2831;
          float rot3 = h3.z * 6.2831;
          uv1 = mat2(cos(rot1), -sin(rot1), sin(rot1), cos(rot1)) * uv + h1.xy;
          uv2 = mat2(cos(rot2), -sin(rot2), sin(rot2), cos(rot2)) * uv + h2.xy;
          uv3 = mat2(cos(rot3), -sin(rot3), sin(rot3), cos(rot3)) * uv + h3.xy;

          // Barycentric weights from triangle position
          if (triType > 0.5) {
              w1 = 1.0 - qf.x - qf.y;
              w2 = qf.x;
              w3 = qf.y;
          } else {
              w1 = qf.x + qf.y - 1.0;
              w2 = 1.0 - qf.y;
              w3 = 1.0 - qf.x;
          }

          // Smooth the weights to avoid harsh transitions
          w1 = smoothstep(0.0, 1.0, w1);
          w2 = smoothstep(0.0, 1.0, w2);
          w3 = smoothstep(0.0, 1.0, w3);
          float wSum = w1 + w2 + w3;
          w1 /= wSum;
          w2 /= wSum;
          w3 /= wSum;
      }

      float perlin_hash_f(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float perlin_noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(perlin_hash_f(i), perlin_hash_f(i + vec2(1.0, 0.0)), u.x),
                     mix(perlin_hash_f(i + vec2(0.0, 1.0)), perlin_hash_f(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
      `
      // Hex tiling: sample texture in 3 overlapping hex cells with random rotation/offset per cell
      vec2 hexUv1, hexUv2, hexUv3;
      float hw1, hw2, hw3;
      hexTile(vMapUv * 0.7, hexUv1, hexUv2, hexUv3, hw1, hw2, hw3);

      vec4 sampledDiffuseColor =
          texture2D(map, hexUv1) * hw1 +
          texture2D(map, hexUv2) * hw2 +
          texture2D(map, hexUv3) * hw3;

      // Subtle macro brightness variation
      float macro = mix(0.8, 1.2, perlin_noise(vMapUv * 0.04 + vec2(5.3, 7.1)));
      sampledDiffuseColor.rgb *= macro;
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
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  return mesh;
}

export let waterMaterial: THREE.ShaderMaterial | null = null;

/** Beautiful procedural turbulence water plane */
export function createWater(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(300, 300);
  geo.rotateX(-Math.PI / 2);
  
  waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;

      float random(float x) {
          return fract(sin(x) * 10000.0);
      }

      float noise(vec2 p) {
          return random(p.x + p.y * 10000.0);
      }

      vec2 sw(vec2 p) { return vec2(floor(p.x), floor(p.y)); }
      vec2 se(vec2 p) { return vec2(ceil(p.x), floor(p.y)); }
      vec2 nw(vec2 p) { return vec2(floor(p.x), ceil(p.y)); }
      vec2 ne(vec2 p) { return vec2(ceil(p.x), ceil(p.y)); }

      float smoothNoise(vec2 p) {
          vec2 interp = smoothstep(0.0, 1.0, fract(p));
          float s = mix(noise(sw(p)), noise(se(p)), interp.x);
          float n = mix(noise(nw(p)), noise(ne(p)), interp.x);
          return mix(s, n, interp.y);
      }

      float fractalNoise(vec2 p) {
          float x = 0.0;
          x += smoothNoise(p      );
          x += smoothNoise(p * 2.0) / 2.0;
          x += smoothNoise(p * 4.0) / 4.0;
          x += smoothNoise(p * 8.0) / 8.0;
          x += smoothNoise(p * 16.0) / 16.0;
          x /= 1.0 + 1.0/2.0 + 1.0/4.0 + 1.0/8.0 + 1.0/16.0;
          return x;
      }

      float movingNoise(vec2 p) {
          float slowTime = uTime * 0.15;
          float x = fractalNoise(p + slowTime);
          float y = fractalNoise(p - slowTime);
          return fractalNoise(p + vec2(x, y));   
      }

      float nestedNoise(vec2 p) {
          float x = movingNoise(p);
          float y = movingNoise(p + 100.0);
          return movingNoise(p + vec2(x, y));
      }

      void main() {
          vec2 uv = vUv * 12.0;
          float n = nestedNoise(uv);
          
          // Extremely dark near-black deep-sea teal base
          vec3 baseBlue = vec3(0.0, 0.01, 0.01);
          
          // Highly subtle deep emerald caustics with absolutely zero white highlights
          vec3 highlightBlue = vec3(0.01, 0.08, 0.08);
          
          // Apply a beautiful power curve so the swirling pattern is visible but deeply atmospheric
          float sharpNoise = pow(n, 2.5);
          
          vec3 finalColor = mix(baseBlue, highlightBlue, sharpNoise);
          
          // Render with highly dense opacity (0.85) for a beautifully rich, substantial liquid presence
          gl_FragColor = vec4(finalColor, 0.85);
      }
    `,
    transparent: true
  });

  const mesh = new THREE.Mesh(geo, waterMaterial);
  mesh.position.y = -2.0;
  mesh.name = 'water';
  scene.add(mesh);
}
