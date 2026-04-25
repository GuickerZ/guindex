# GuIndex - Stremio Addon

Addon proxy that sends magnets/HTTP links through Real-Debrid or TorBox, returning direct playable URLs. Tuned for Vercel and ready to drop into AIOStreams.

## Features
- Real-Debrid and TorBox support (torrent + WebDL), with real cache detection.
- Fast cached playback: cached torrents usually resolve in ~1s; wait-video only when not ready.
- Lean payload: trims unused fields for TorBox and limits stream count (default 12).
- Placeholder MP4 for downloading state (configurable).
- Works on Vercel/serverless; no external backend required.

## Quick start
1) Install dependencies  
   ```bash
   npm install
   ```
2) Environment (set at deploy or locally)  
   ```bash
   export BASE_URL=https://your-domain.vercel.app   # required in prod
   export PORT=7000
   export LOG_LEVEL=info
   export TORBOX_WAIT_VIDEO_URL=https://aiostreams.elfhosted.com/static/downloading.mp4
   export TORBOX_STREAM_LIMIT=12
   # optional defaults: REALDEBRID_TOKEN, TORBOX_TOKEN
   ```
3) Run locally  
   ```bash
   npm run dev   # or npm start after build
   ```
4) Install in Stremio  
   - `http://localhost:7000/manifest.json?debridProvider=torbox&torboxToken=TOKEN`  
   - or `...debridProvider=realdebrid&realdebridToken=TOKEN`

## AIOStreams quick setup
Copy one of these URLs (replace TOKEN) into AIOStreams:
- TorBox: `https://your-domain.vercel.app/manifest.json?debridProvider=torbox&torboxToken=TOKEN`
- Real-Debrid: `https://your-domain.vercel.app/manifest.json?debridProvider=realdebrid&realdebridToken=TOKEN`

Tokens can also be passed via headers: `x-tb-token`, `x-rd-token`, `x-debrid-provider`.

## Routes
- `GET /manifest.json` (+ token variants) – Stremio manifest
- `GET /configure` – helper page with ready-to-copy URLs
- `GET /stream/:type/:id.json` – stream discovery
- `GET|HEAD /resolve` – resolves magnet/URL via chosen debrid, returns 302 to direct link or wait video
- `GET /placeholder/downloading.mp4` – bundled placeholder (fallback if you don’t set an external one)
- `GET /debug` – shows loaded config

## Behavior notes
- `[TB⚡]` only when TorBox reports cached/present and a direct link was obtained; `[TB…]` while downloading.
- TorBox streams sorted by ready desc, size desc; capped by `TORBOX_STREAM_LIMIT` (default 12).
- Cached probing uses `checkcached` with file listing and is memoized for 5 minutes.
- Request timeouts to TorBox are short (4s) and retries are limited (0/1/2.5s) to keep latency low.

## Build/test
- Type-check: `npx tsc`
- Production build: `npm run build`

## Tokens
- Query: `?torboxToken=...` or `?realdebridToken=...`
- Headers: `x-tb-token`, `x-rd-token`
- Provider selector: `?debridProvider=torbox|realdebrid`

## Deployment
Deploy to Vercel with `BASE_URL` set to the deployed domain. Public placeholder video is recommended via `TORBOX_WAIT_VIDEO_URL`. No external Go/StremThru backend is required.
