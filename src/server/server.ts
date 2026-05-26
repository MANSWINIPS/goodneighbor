import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { context, reddit, redis } from "@devvit/web/server";
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import type {
  OnAppInstallRequest,
  OnCommentCreateRequest,
  OnModActionRequest,
  OnPostCreateRequest,
} from "@devvit/shared/types/triggers.js";
import {
  ApiEndpoint,
  Badge,
  BADGE_EMOJI,
  BADGE_LABEL,
  SCORE,
  type EndorseRequest,
  type EndorseResponse,
  type InitResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type UserStatsResponse,
} from "../shared/api.ts";

// ---------- HTTP entrypoint ---------------------------------------------------

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;
  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  const endpoint = stripQuery(url) as ApiEndpoint;
  let body: PartialJsonValue | UiResponse | TriggerResponse | ErrorResponse;

  switch (endpoint) {
    // Client APIs
    case ApiEndpoint.Init:
      body = await onInit();
      break;
    case ApiEndpoint.Leaderboard:
      body = await onLeaderboard();
      break;
    case ApiEndpoint.Endorse:
      body = await onEndorseApi(req);
      break;
    case ApiEndpoint.UserStats:
      body = await onUserStats(req);
      break;
    // Menu actions
    case ApiEndpoint.MenuPublishLeaderboard:
      body = await onMenuPublishLeaderboard();
      break;
    case ApiEndpoint.MenuEndorsePostAuthor:
      body = await onMenuEndorsePostAuthor();
      break;
    case ApiEndpoint.MenuEndorseCommenter:
      body = await onMenuEndorseCommenter();
      break;
    // Triggers
    case ApiEndpoint.TriggerAppInstall:
      body = await onAppInstall(req);
      break;
    case ApiEndpoint.TriggerCommentCreate:
      body = await onCommentCreate(req);
      break;
    case ApiEndpoint.TriggerPostCreate:
      body = await onPostCreate(req);
      break;
    case ApiEndpoint.TriggerModAction:
      body = await onModAction(req);
      break;
    // Scheduler
    case ApiEndpoint.SchedulerWeeklyMvp:
      body = await onWeeklyMvp();
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  const status =
    body && typeof body === "object" && "status" in body
      ? (body as ErrorResponse).status
      : 200;
  writeJSON(status, body as PartialJsonValue, rsp);
}

type ErrorResponse = { error: string; status: number };

// ---------- Redis keys --------------------------------------------------------

const k = {
  /** ZSET: member=username, score=cumulative score for this subreddit. */
  score: (sub: string) => `gn:score:${sub}`,
  /** STRING (JSON list): badges earned by username in this subreddit. */
  badges: (sub: string, user: string) => `gn:badges:${sub}:${user}`,
  /** STRING (timestamp ms): when this user was last mod-endorsed in this sub. */
  endorsed: (sub: string, user: string) => `gn:endorsed:${sub}:${user}`,
  /** STRING (JSON snapshot): last weekly MVP snapshot for this sub. */
  weekly: (sub: string) => `gn:weekly:${sub}`,
} as const;

// ---------- Score + badges ----------------------------------------------------

const APP_BOT_SUFFIX = "-app"; // skip the app's own bot account
const IGNORED_USERS = new Set(["AutoModerator"]);

function shouldIgnoreUser(username: string | undefined): boolean {
  if (!username) return true;
  if (IGNORED_USERS.has(username)) return true;
  if (username.endsWith(APP_BOT_SUFFIX)) return true;
  return false;
}

async function getBadges(sub: string, username: string): Promise<Badge[]> {
  const raw = await redis.get(k.badges(sub, username));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is Badge =>
      Object.values(Badge).includes(b as Badge),
    );
  } catch {
    return [];
  }
}

async function setBadges(
  sub: string,
  username: string,
  badges: Badge[],
): Promise<void> {
  const unique = Array.from(new Set(badges));
  await redis.set(k.badges(sub, username), JSON.stringify(unique));
}

/** Re-evaluate auto-awarded badges (Newcomer, Active, LongTime) from score. */
function deriveTierBadges(score: number): Badge[] {
  const out: Badge[] = [];
  if (score >= 1) out.push(Badge.Newcomer);
  if (score >= 25) out.push(Badge.Active);
  if (score >= 100) out.push(Badge.LongTime);
  return out;
}

function flairText(badges: Badge[], score: number): string {
  const emojis = badges.map((b) => BADGE_EMOJI[b]).join("");
  return emojis ? `${emojis} • ${score}` : `${score}`;
}

async function applyFlair(
  sub: string,
  username: string,
  badges: Badge[],
  score: number,
): Promise<void> {
  try {
    await reddit.setUserFlair({
      subredditName: sub,
      username,
      text: flairText(badges, score),
      cssClass: "goodneighbor",
    });
  } catch (err) {
    // Flair may be disabled, user may not be in the sub, etc. Non-fatal.
    console.warn(
      `goodneighbor: setUserFlair failed for u/${username} in r/${sub}: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}

/**
 * Award points and recompute badges/flair for a user.
 * Returns the new total score and the user's full badge set.
 */
async function awardPoints(
  sub: string,
  username: string,
  delta: number,
  extraBadges: Badge[] = [],
): Promise<{ score: number; badges: Badge[] }> {
  if (shouldIgnoreUser(username) || delta <= 0) {
    return { score: 0, badges: [] };
  }
  const score = await redis.zIncrBy(k.score(sub), username, delta);
  const existing = await getBadges(sub, username);
  const next = Array.from(
    new Set<Badge>([...existing, ...deriveTierBadges(score), ...extraBadges]),
  );
  if (
    next.length !== existing.length ||
    next.some((b) => !existing.includes(b))
  ) {
    await setBadges(sub, username, next);
  }
  await applyFlair(sub, username, next, score);
  return { score, badges: next };
}

// ---------- Leaderboard helpers ----------------------------------------------

async function getTop(sub: string, count: number): Promise<LeaderboardEntry[]> {
  const rows = await redis.zRange(k.score(sub), 0, count - 1, {
    reverse: true,
    by: "rank",
  });
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const badges = await getBadges(sub, row.member);
    entries.push({
      rank: i + 1,
      username: row.member,
      score: Math.round(row.score),
      badges,
    });
  }
  return entries;
}

// ---------- Context helpers ---------------------------------------------------

function getSubredditName(): string {
  const sub = context.subredditName;
  if (!sub) throw Error("no subreddit context");
  return sub;
}

function getPostId(): string {
  if (!context.postId) throw Error("no post ID");
  return context.postId;
}

async function isCurrentUserModerator(sub: string): Promise<boolean> {
  const username = context.username;
  if (!username) return false;
  try {
    // Cheap check: try to read mod list and look for username.
    // For very large mod teams this is fine since mod count is small.
    const mods = await reddit
      .getSubredditInfoByName(sub)
      .then((info) => info.permalink) // ignored — just to verify API works
      .catch(() => null);
    void mods;
    const user = await reddit.getUserByUsername(username);
    if (!user) return false;
    const subreddits = await user.getModPermissionsForSubreddit(sub).catch(
      () => null,
    );
    return subreddits != null && subreddits.length > 0;
  } catch {
    return false;
  }
}

// ---------- Client API handlers ----------------------------------------------

async function onInit(): Promise<InitResponse> {
  const sub = getSubredditName();
  const postId = getPostId();
  const username = context.username ?? "anonymous";
  const top = await getTop(sub, 10);
  const selfScore = username
    ? Math.round((await redis.zScore(k.score(sub), username)) ?? 0)
    : 0;
  const selfBadges = username ? await getBadges(sub, username) : [];
  const isModerator = await isCurrentUserModerator(sub);
  return {
    type: "init",
    postId,
    subredditName: sub,
    username,
    isModerator,
    selfScore,
    selfBadges,
    top,
  };
}

async function onLeaderboard(): Promise<LeaderboardResponse> {
  const sub = getSubredditName();
  const top = await getTop(sub, 25);
  return { type: "leaderboard", subredditName: sub, top };
}

async function onEndorseApi(req: IncomingMessage): Promise<EndorseResponse> {
  const sub = getSubredditName();
  const isMod = await isCurrentUserModerator(sub);
  if (!isMod) {
    throw Error("Only moderators can endorse users.");
  }
  const { username } = await readJSON<EndorseRequest>(req);
  if (!username || typeof username !== "string") {
    throw Error("missing username");
  }
  return await doEndorse(sub, username);
}

async function onUserStats(req: IncomingMessage): Promise<UserStatsResponse> {
  const sub = getSubredditName();
  const { username } = await readJSON<{ username: string }>(req).catch(() => ({
    username: context.username ?? "",
  }));
  if (!username) throw Error("missing username");
  const score = Math.round(
    (await redis.zScore(k.score(sub), username)) ?? 0,
  );
  const rank = await redis.zRank(k.score(sub), username);
  const badges = await getBadges(sub, username);
  return {
    type: "user-stats",
    username,
    score,
    rank: rank == null ? null : rank + 1,
    badges,
  };
}

// ---------- Endorsement shared logic -----------------------------------------

async function doEndorse(
  sub: string,
  username: string,
): Promise<EndorseResponse> {
  if (shouldIgnoreUser(username)) {
    throw Error(`Cannot endorse u/${username}.`);
  }
  // Mark endorsement, but don't double-count the +25 within 24h.
  const endorseKey = k.endorsed(sub, username);
  const last = await redis.get(endorseKey);
  const now = Date.now();
  const cooldownMs = 24 * 60 * 60 * 1000;
  const delta =
    last && now - Number(last) < cooldownMs ? 0 : SCORE.MOD_ENDORSEMENT;
  await redis.set(endorseKey, String(now));
  const { score, badges } = await awardPoints(sub, username, delta, [
    Badge.ModEndorsed,
  ]);
  return { type: "endorse", username, score, badges };
}

// ---------- Menu action handlers ---------------------------------------------

async function onMenuPublishLeaderboard(): Promise<UiResponse> {
  const sub = getSubredditName();
  const top = await getTop(sub, 10);
  const post = await reddit.submitCustomPost({
    subredditName: sub,
    title: `🌟 GoodNeighbor: this week's top contributors in r/${sub}`,
    splash: {
      appDisplayName: "GoodNeighbor",
      buttonLabel: "View leaderboard",
      heading: "Top contributors",
      description:
        top.length > 0
          ? `#1 u/${top[0]!.username} with ${top[0]!.score} points`
          : "Be the first to earn points by contributing!",
    },
  });
  await redis.set(
    k.weekly(sub),
    JSON.stringify({ publishedAt: Date.now(), postId: post.id, top }),
  );
  return {
    showToast: { text: "Leaderboard post created.", appearance: "success" },
    navigateTo: post.url,
  };
}

async function onMenuEndorsePostAuthor(): Promise<UiResponse> {
  const sub = getSubredditName();
  const postId = context.postId;
  if (!postId) {
    return {
      showToast: { text: "No post context.", appearance: "neutral" },
    };
  }
  const post = await reddit.getPostById(postId);
  const author = post.authorName;
  if (!author) {
    return { showToast: { text: "No author found.", appearance: "neutral" } };
  }
  const result = await doEndorse(sub, author);
  return {
    showToast: {
      text: `Endorsed u/${author} — ${result.score} points`,
      appearance: "success",
    },
  };
}

async function onMenuEndorseCommenter(): Promise<UiResponse> {
  const sub = getSubredditName();
  const commentId = context.commentId;
  if (!commentId) {
    return {
      showToast: { text: "No comment context.", appearance: "neutral" },
    };
  }
  const comment = await reddit.getCommentById(commentId);
  const author = comment.authorName;
  if (!author) {
    return { showToast: { text: "No author found.", appearance: "neutral" } };
  }
  const result = await doEndorse(sub, author);
  return {
    showToast: {
      text: `Endorsed u/${author} — ${result.score} points`,
      appearance: "success",
    },
  };
}

// ---------- Trigger handlers --------------------------------------------------

async function onAppInstall(req: IncomingMessage): Promise<TriggerResponse> {
  const payload = (await readJSON<OnAppInstallRequest>(req).catch(
    () => ({}),
  )) as Partial<OnAppInstallRequest>;
  const sub = payload.subreddit?.name ?? context.subredditName;
  if (!sub) return {};
  try {
    await reddit.submitCustomPost({
      subredditName: sub,
      title: "🌟 GoodNeighbor is now active — top contributors will appear here",
      splash: {
        appDisplayName: "GoodNeighbor",
        buttonLabel: "View leaderboard",
        heading: "GoodNeighbor",
        description: "Positive contributors get recognised here every week.",
      },
    });
  } catch (err) {
    console.warn(
      `goodneighbor: app-install post creation skipped: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  return {};
}

async function onCommentCreate(req: IncomingMessage): Promise<TriggerResponse> {
  const payload = await readJSON<OnCommentCreateRequest>(req);
  const sub = payload.subreddit?.name;
  const author = payload.author?.name;
  if (!sub || !author) return {};
  await awardPoints(sub, author, SCORE.COMMENT);
  return {};
}

async function onPostCreate(req: IncomingMessage): Promise<TriggerResponse> {
  const payload = await readJSON<OnPostCreateRequest>(req);
  const sub = payload.subreddit?.name;
  const author = payload.author?.name;
  if (!sub || !author) return {};
  await awardPoints(sub, author, SCORE.POST);
  return {};
}

async function onModAction(req: IncomingMessage): Promise<TriggerResponse> {
  const payload = await readJSON<OnModActionRequest>(req);
  const sub = payload.subreddit?.name;
  const action = payload.action;
  if (!sub || !action) return {};
  // Award the original author when their content is mod-approved.
  if (action === "approvelink" || action === "approvecomment") {
    const author =
      payload.targetPost?.authorName ?? payload.targetComment?.authorName;
    if (author) {
      await awardPoints(sub, author, SCORE.MOD_APPROVAL);
    }
  }
  return {};
}

// ---------- Scheduler handlers -----------------------------------------------

async function onWeeklyMvp(): Promise<TriggerResponse> {
  const sub = context.subredditName;
  if (!sub) return {};
  const top = await getTop(sub, 10);
  if (top.length === 0) return {};

  // Award the weekly MVP badge to #1.
  const mvp = top[0]!;
  const existing = await getBadges(sub, mvp.username);
  if (!existing.includes(Badge.WeeklyMvp)) {
    const next = Array.from(new Set([...existing, Badge.WeeklyMvp]));
    await setBadges(sub, mvp.username, next);
    await applyFlair(sub, mvp.username, next, mvp.score);
  }

  // Publish the leaderboard as a custom post.
  const lines = top
    .slice(0, 5)
    .map(
      (e) =>
        `${e.rank}. u/${e.username} — ${e.score} pts ${e.badges
          .map((b) => BADGE_EMOJI[b])
          .join("")}`,
    )
    .join("\n");
  void lines; // placeholder for future plain-text version
  try {
    const post = await reddit.submitCustomPost({
      subredditName: sub,
      title: `🌟 GoodNeighbor MVP: u/${mvp.username} — ${mvp.score} points`,
      splash: {
        appDisplayName: "GoodNeighbor",
        buttonLabel: "View leaderboard",
        heading: `This week's MVP: u/${mvp.username}`,
        description: `${BADGE_LABEL[Badge.WeeklyMvp]} — ${mvp.score} points`,
      },
    });
    await redis.set(
      k.weekly(sub),
      JSON.stringify({ publishedAt: Date.now(), postId: post.id, top }),
    );
  } catch (err) {
    console.warn(
      `goodneighbor: weekly post failed: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  return {};
}

// ---------- HTTP plumbing -----------------------------------------------------

function stripQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  const text = `${Buffer.concat(chunks)}`;
  return text ? (JSON.parse(text) as T) : ({} as T);
}

