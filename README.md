# Three.js Open World Demo

A browser-based open-world prototype built with **Three.js**, **React**, **TypeScript**, and **Vite**.

## Features

- Third-person character controller (WASD movement)
- Mouse-look camera (pointer lock) orbiting around the player
- Procedural rolling-hills terrain with vertex colours
- Water plane at sea level
- 80+ pine trees, 60 rocks, 200 grass tufts scattered across the world
- Distant mountain silhouettes on the horizon
- Directional sun with soft shadows + ambient/fill lighting
- Distance fog for atmosphere

## Controls

| Key / Input | Action |
|-------------|--------|
| W / ↑       | Move forward |
| S / ↓       | Move backward |
| A / ←       | Strafe left |
| D / →       | Strafe right |
| Mouse drag  | Rotate camera (click canvas first to capture mouse) |
| Esc         | Release mouse |

## Running locally

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Building for production

```bash
npm run build
npm run preview
```

## Project layout

```
src/
  App.tsx                  — React root, canvas + HUD
  index.css                — Full-screen game styles
  game/
    Game.ts                — Scene setup, renderer, game loop
    Player.ts              — Humanoid character mesh + WASD movement
    ThirdPersonCamera.ts   — Mouse-orbit follow camera
    InputManager.ts        — Keyboard + pointer-lock mouse input
    terrain.ts             — Procedural terrain + water
    environment.ts         — Trees, rocks, grass props
```
