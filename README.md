# GoodNeighbor

**Reward the helpers, not just remove the harm.**

GoodNeighbor is a Devvit app for the [Reddit Mod Tools & Migration Hackathon 2026](https://mod-tools-migration.devpost.com/). It flips moderation from purely punitive (remove / ban / mute) to **recognition-driven** — automatically scoring positive contributions, awarding visible badges, letting mods endorse helpful members with one tap, and publishing a weekly MVP leaderboard.

---

## Install in 30 seconds (for judges)

You do **not** need to clone this repo to try GoodNeighbor. The app is uploaded to the Devvit developer portal.

1. Go to **https://developers.reddit.com/apps/goodneighbor-app**.
2. Click the green **Install** button (top right).
3. Pick **any subreddit you moderate** from the dropdown and confirm. (If you don't moderate one already, create a private test sub in 10 seconds at https://www.reddit.com/subreddits/create.)
4. Open that subreddit on Reddit (web or mobile app).
5. Make a comment or post — your username is now scored. Then open any post or comment by another user → `⋮` menu → tap **`GoodNeighbor: endorse author`** / **`endorse commenter`**.
6. Open the subreddit overflow `⋮` menu → **`GoodNeighbor: top contributors`** to see the leaderboard custom post.

The weekly MVP custom post will then auto-publish every Sunday 17:00 UTC.

The alternative for judges who prefer the CLI:

```bash
npx devvit install goodneighbor-app r/<your_subreddit>
```

A live demo install also lives at **r/GoodNeighborTest_NI** for browsing existing leaderboard posts.

---

## The problem

Moderation tooling — including the rest of this hackathon — is overwhelmingly about catching bad behavior. But every long-running community knows the truth: the easiest way to reduce bad behavior is to **amplify the good** so it sets the cultural tone.

The mod tools to do that don't exist. Today, if a mod wants to recognize a great contributor they have to:

- Remember the username
- Manually set user flair (with no shared convention across the mod team)
- Maybe shout them out in a sticky comment that disappears in a week

There's no durable record, no shared mod recognition, no public leaderboard, no automation. The "thank the helpers" loop is purely manual and almost never happens at scale.

## What GoodNeighbor does

Once installed, GoodNeighbor runs in the background and:

1. **Listens** for every new post, new comment, and mod action in the subreddit.
2. **Scores** each contributor: posts = 3 pts, comments = 1 pt, mod approvals = 5 pts, mod endorsements = 25 pts.
3. **Awards badges** automatically as scores cross thresholds — 🌱 Newcomer, 🤝 Active, 🏛️ Long-time member, ✅ Mod-endorsed, ⭐ Weekly MVP.
4. **Applies user flair** automatically (e.g. `🌱🤝✅ • 128`) — so positive members are visually recognized everywhere in the sub.
5. **Publishes a weekly MVP custom post** every Sunday 17:00 UTC with the top 10 contributors of the week.
6. **Lets mods endorse** any user with one tap from a post menu, comment menu, or the in-post leaderboard UI.

## Three mod entry points

| Where | Menu item | Behavior |
|---|---|---|
| Subreddit overflow menu | `GoodNeighbor: top contributors` | Publishes a fresh leaderboard custom post |
| Any post's `⋮` menu | `GoodNeighbor: endorse author` | +25 pts and ✅ badge to the post's author |
| Any comment's `⋮` menu | `GoodNeighbor: endorse commenter` | +25 pts and ✅ badge to the commenter |

All three are gated to `forUserType: moderator`. Inside the leaderboard custom post, mods also get an inline **Endorse** button on each row plus a free-text endorse input for off-platform tips.

## Why it matters for the hackathon

The Mod Tools track explicitly calls out **"incentivize good behavior"** as an alternative to enforcement — a lane no existing app in the Devvit ecosystem occupies. GoodNeighbor:

1. **Reduces mod workload** by handling 95% of recognition automatically — mods only touch the truly notable cases via one-tap endorse.
2. **Builds durable community memory** — flair and badges persist across mod shifts, so the community sees who's been consistently helpful for years, not just this week.
3. **Scales to mobile** — the entire mod loop (endorse from post, endorse from comment, view leaderboard) works inside the Reddit mobile app where most modding happens.
4. **Shifts culture** — every time a regular user spots an `⭐ Weekly MVP` flair in a thread, the implicit message is "this is what we celebrate here." That's mod-tool ROI that compounds.

## How it gets used in production

`r/GoodNeighborTest_NI` is only the developer sandbox. The real deployment model is:

1. The app is published to the Devvit App Directory.
2. A moderator of any subreddit installs GoodNeighbor on their community.
3. Background triggers start scoring contributions immediately — zero config required.
4. The three menu items appear on **that subreddit's own posts and comments** — visible only to that subreddit's mods.
5. Every Sunday, the weekly MVP post lands automatically.
6. Each install is fully isolated: its own scores, its own badges, its own leaderboard.

## Tech

- **Devvit Web 0.12.24** (HTTP server + webview pattern)
- **TypeScript** end-to-end (`src/shared/api.ts` is the typed contract)
- **Redis** sorted set for scores (`gn:score:{sub}`), JSON for badges (`gn:badges:{sub}:{user}`), 24h endorsement cooldown (`gn:endorsed:{sub}:{user}`), weekly snapshot (`gn:weekly:{sub}`)
- **Reddit Plugin** at `moderator` scope for flair application, user/post/comment lookup, custom post submission
- **Devvit Scheduler** with a cron task (`0 17 * * 0`) for the weekly MVP job
- **Devvit Triggers** — `onCommentCreate`, `onPostCreate`, `onModAction`, `onAppInstall`
- **esbuild** for client + server bundling

## Repository layout

```
goodneighbor-app/
├─ devvit.json             # app config: menus, triggers, scheduler, permissions
├─ public/                 # webview assets
│  ├─ game.html / game.css / game.js
│  └─ splash.html / splash.css / splash.js
├─ src/
│  ├─ shared/api.ts        # typed API contract (badges, scores, endpoints)
│  ├─ server/
│  │  ├─ index.ts          # createServer + listen
│  │  └─ server.ts         # triggers, scoring engine, badges, scheduler, HTTP
│  └─ client/
│     ├─ splash.ts         # inline splash screen
│     └─ game.ts           # leaderboard + endorse UI
└─ tools/build.ts          # esbuild config
```

## Permissions declared

```jsonc
"permissions": {
  "redis": true,
  "reddit": { "enable": true, "scope": "moderator" }
}
```

The `moderator` scope is required for `setUserFlair` (automatic badge application). All other Reddit API calls (`getPostById`, `getCommentById`, `getUserByUsername`, `submitCustomPost`) sit within the `user` scope.

## Scoring rules

| Event | Points |
|---|---|
| New comment | +1 |
| New post | +3 |
| Mod approves the user's removed content | +5 |
| Mod endorsement (menu or UI button) | +25 (capped once per 24h per user) |

Tier badges derive purely from cumulative score:

| Badge | Threshold |
|---|---|
| 🌱 Newcomer | ≥ 1 |
| 🤝 Active | ≥ 25 |
| 🏛️ Long-time | ≥ 100 |
| ✅ Mod-endorsed | mod-applied |
| ⭐ Weekly MVP | top of weekly leaderboard |

Flair format combines all earned badges plus the score: `🌱🤝✅ • 128`.

## Local development

```bash
npm install
npm run type-check
npm run build
npm run dev <your_test_subreddit>
```

Then visit `https://www.reddit.com/r/<your_test_subreddit>/` and use any post/comment `⋮` menu → `GoodNeighbor: endorse …`, or the subreddit overflow menu → `GoodNeighbor: top contributors`.

## License

BSD-3-Clause (see `LICENSE`).
