# Road Runner — Frontend

A React + Vite frontend for the 2D pixel-art endless runner.

## Run locally
```bash
cd frontend
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Structure
- `src/app`: routes
- `src/components`: reusable UI and game components
- `src/game`: Canvas game engine, character physics, obstacles and renderers
- `src/pages`: routed pages
- `src/styles`: global styles and page-specific styles

Gameplay currently runs client-side. Backend accounts and global leaderboard integration are a later milestone.