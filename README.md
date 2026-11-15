# Moments

AI clipping for gameplay recordings: upload a long session, get the moments worth posting as vertical shorts.

Status: UI phase. Screens use invented data from `src/lib/mock-data.ts`; uploads, processing and accounts are not connected yet.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS 4 · shadcn/ui (Base UI) · lucide-react

## Where things live

- `src/app/globals.css`: design tokens. Orange (`moment`) marks the moment only; everything else is neutral.
- `src/components/shell/`: sidebar, top bar, phone tab bar, nav config.
- `src/components/home/`: Home screen sections.
- `src/components/brand/`: logo and the moment line.
- `src/components/media/scene-thumb.tsx`: placeholder thumbnails (replaced by real video frames later).
