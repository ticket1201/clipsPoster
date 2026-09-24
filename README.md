# Clips Poster

Local-first system for discovering fast-growing Twitch and Kick clips, ranking candidates, processing vertical video, and publishing short-form content.

## Phase 0: local bootstrap

### Requirements

- Node.js 24+
- Docker Desktop with Docker Compose
- FFmpeg (install separately on macOS with `brew install ffmpeg`)

### Setup

```bash
cp .env.example .env.local
npm install
npm run infra:up
npm run db:generate
npm run db:deploy
```

Run each application in a separate terminal:

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
```

- Dashboard: <http://localhost:3000>
- API health: <http://localhost:4000/health>

## Kick collector

Kick support is isolated behind `@clips-poster/kick`. OAuth support follows the official Kick API. Clip listing currently uses Kick's read-only web endpoint because clip listing is not available in the official Public API yet.

Add a channel and queue its first collection:

```bash
curl -X POST http://localhost:4000/kick/channels \
  -H 'content-type: application/json' \
  -d '{"slug":"xqc"}'
```

Run one collection directly:

```bash
npm run collect:kick -- xqc
```

List saved clips:

```bash
curl http://localhost:4000/kick/clips
```

The worker registers a BullMQ scheduler on startup and refreshes every active
Kick channel every five minutes. Each pass stores a metric observation and
updates clip velocity windows for 5, 15, and 60 minutes.

Inspect the scheduler and collector counters:

```bash
curl http://localhost:4000/kick/status
```

The dashboard at <http://localhost:3000> shows the same live counters, lets you
add Kick channels, trigger a collection manually, and opens the latest clips.

## Twitch collector

Twitch collection works without credentials through the same anonymous,
read-only GraphQL surface used by twitch.tv. It only reads public channel and
clip data. Because this endpoint is not an officially supported public API, it
may change; when credentials are available, the collector automatically prefers
the official Helix API instead.

Optional official API credentials can be placed in `.env.local`:

```dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
```

The Twitch form on the dashboard is active without them. Adding a channel queues
its first collection; all active Twitch channels are then refreshed every five
minutes. You can also run a one-off collection:

```bash
npm run collect:twitch -- twitchdev
```

## TikTok draft upload credentials

Create an app in TikTok for Developers, add Login Kit and Content Posting API,
then keep the app credentials server-side in `.env.local`:

```dotenv
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=https://your-domain.example/actions/tiktok/callback
```

The redirect URI must exactly match the HTTPS URI configured for Login Kit in
the TikTok Developer Portal. Never expose the client secret in browser code or
commit `.env.local`.

## Vertical video processing

Use the `9:16` button beside a clip on the dashboard to queue local processing.
The worker downloads the source video and renders a 1080×1920 MP4 with:

- a detected, enlarged streamer webcam in the upper panel when a stable face is found;
- a zoomed gameplay crop in the lower panel, with the legacy full-frame layout as fallback;
- a source badge such as `TWITCH / inkmate0` or `KICK / inkmate666`;
- H.264 video and AAC audio, ready for short-form platforms.

Raw files are stored in `storage/raw`; finished exports are stored in
`storage/processed`. Once processing finishes, the dashboard replaces the
button with an `MP4` link.

For routed channels, clips with `viralScore > 30` are automatically queued for
9:16 rendering and approved, but they are never sent to a publishing platform
automatically. The operator starts TikTok, YouTube, and Instagram delivery
manually with the dashboard's `Опубликовать` action.

## Instagram Reels credentials

Instagram publishing uses the official Instagram API with Instagram Login and
requires a Professional account (Business or Creator). Add the Instagram API
product to a Meta app, enable `instagram_business_basic` and
`instagram_business_content_publish`, and configure the exact HTTPS callback:

```dotenv
INSTAGRAM_APP_ID=your_meta_app_id
INSTAGRAM_APP_SECRET=your_meta_app_secret
INSTAGRAM_REDIRECT_URI=https://your-domain.example/actions/instagram/callback
INSTAGRAM_PUBLIC_BASE_URL=https://your-domain.example
INSTAGRAM_GRAPH_VERSION=v25.0
```

`INSTAGRAM_PUBLIC_BASE_URL` must point to the running web app. Meta downloads
the processed MP4 from a temporary signed `/actions/instagram/media/:clipId`
URL, so an ephemeral
tunnel URL must be updated in both `.env.local` and the Meta app whenever it
changes. Connected Instagram accounts can be routed independently per Twitch
or Kick source. Manual publishing sends a public Reel to every selected
Instagram account.

### Quality checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

PostgreSQL and Redis use named Docker volumes, so their data survives container restarts. Raw and processed video stays under `./storage` and is ignored by Git.
