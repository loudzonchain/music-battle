# Music Battle React + TypeScript Migration Guide

This project is currently:
- Server-rendered static files (`index.html`, `leaderboard.html`, `script.js`, `styles.css`)
- Express + SQLite backend (`server.js`)
- Mixed auth model (frontend username in `localStorage`, backend has full email/password/session auth)

This guide gives a practical path to migrate the frontend to React + TypeScript while keeping your backend and DB.

## 1. High-priority fixes before migration

Do these first so you do not carry critical issues into the new app:

1. `leaderboard.html` hardcodes `http://localhost:3000/api`. Replace with `window.location.origin + '/api'`.
2. `express.static(path.join(__dirname))` can expose server files and DB (`musicbattle.db`). Serve only a dedicated public/build folder.
3. Validate `/api/vote` input (`winnerId`, `loserId`):
   - Must be integers
   - Must exist in `songs`
   - Must be different IDs
4. Add server-side protections:
   - Set a strong `SESSION_SECRET` in env
   - Restrict CORS origin to known frontend origin(s)
   - Add `helmet`
   - Add rate limiting on auth and vote routes

## 2. Create a React + TS frontend app

From repo root:

```bash
npm create vite@latest client -- --template react-ts
cd client
npm install
npm install react-router-dom @tanstack/react-query react-youtube zod
```

Recommended: keep backend in root and frontend in `client/`.

## 3. Target structure

```txt
music-battle/
  server.js
  musicbattle.db
  client/
    src/
      api/
        client.ts
        types.ts
      components/
        SongCard.tsx
        UserBar.tsx
      pages/
        BattlePage.tsx
        LeaderboardPage.tsx
      hooks/
        useBattle.ts
        useVote.ts
      App.tsx
      main.tsx
```

## 4. Add typed API models first

Create `client/src/api/types.ts` and define types from your existing backend responses:

- `Song`
- `BattleResponse` (`{ left: Song; right: Song }`)
- `StatsResponse`
- `LeaderboardSong`
- Auth payloads if you keep backend auth

Then build one fetch wrapper in `client/src/api/client.ts`:

- Base URL from env: `VITE_API_BASE_URL` (default `'/api'`)
- Shared `fetchJson<T>()` with proper error handling
- `credentials: 'include'` for session routes

## 5. Migrate pages in this order

1. `LeaderboardPage` (simpler, read-only)
2. `BattlePage` (YouTube players + voting flow)
3. `UserBar` and username/auth state handling

Map existing DOM/JS behavior:

- `loadNextBattle()` -> `useQuery` + invalidation after vote
- `vote(side)` -> `useMutation`
- `battlesCompleted` -> derived from `/api/stats` or local session state
- Winner animation -> conditional CSS class in React state

## 6. Replace global script patterns

Current code relies on:
- inline `onclick` handlers
- global YouTube callback `onYouTubeIframeAPIReady`

In React:
- Use component event handlers (`onClick`)
- Use `react-youtube` or a typed wrapper component for player lifecycle
- Keep player refs with `useRef`

## 7. Route setup

In React Router:

- `/` -> `BattlePage`
- `/leaderboard` -> `LeaderboardPage`

Then remove separate `leaderboard.html`.

## 8. Build and serve React in production

After migration, serve only built frontend assets from Express:

1. Build frontend: `cd client && npm run build`
2. Serve `client/dist` from Express static middleware
3. Keep `/api/*` routes unchanged
4. Add a SPA fallback route for non-API paths

## 9. TypeScript and quality baseline

Add these before finishing migration:

```bash
cd client
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react-hooks prettier
```

Recommended checks:

- `tsc --noEmit`
- `eslint .`
- basic tests with Vitest + React Testing Library for:
  - vote flow
  - leaderboard render
  - API error states

## 10. Suggested improvements after migration

Prioritized recommendations based on this codebase:

1. Unify identity model:
   - Either keep simple local username only, or fully use backend auth.
   - Do not keep both local-only and backend-auth in parallel.
2. Add optimistic UI for voting with rollback on failure.
3. Prevent double votes by disabling vote buttons while mutation is pending.
4. Handle all non-200 API responses in UI (toast + retry actions).
5. Move inline leaderboard styles into component-level or global CSS modules.
6. Add database indexes:
   - `votes(user_id, voted_at)`
   - `songs(votes)`
   - `user_preferences(user_id, score)`
7. Wrap vote insert + song update in a SQLite transaction for consistency.
8. Add structured request logging and centralized API error middleware.
9. Add a small seed script and `.env.example` for reproducible setup.
10. Add CI checks (lint, typecheck, test) to prevent regressions.

## 11. Minimal migration checklist

- [ ] Critical backend/security fixes applied
- [ ] React + TS app scaffolded in `client/`
- [ ] Typed API layer in place
- [ ] Battle + leaderboard pages migrated
- [ ] Routing replaces separate HTML files
- [ ] Frontend build served from Express
- [ ] Legacy `script.js` and HTML pages removed after parity
- [ ] Lint/typecheck/tests pass
