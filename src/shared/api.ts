/**
 * Shared API contract between client and server.
 *
 * GoodNeighbor: a positive-behavior recognition app for subreddits.
 * Tracks contributions, awards badges, and lets moderators endorse
 * helpful members with one click.
 */

/** Badge identifiers awarded automatically based on cumulative score. */
export const Badge = {
  Newcomer: "newcomer", // first contribution
  Active: "active", // score >= 25
  LongTime: "long_time", // score >= 100
  ModEndorsed: "mod_endorsed", // mod-applied
  WeeklyMvp: "weekly_mvp", // top of weekly leaderboard
} as const;
export type Badge = (typeof Badge)[keyof typeof Badge];

export const BADGE_EMOJI: Record<Badge, string> = {
  newcomer: "🌱",
  active: "🤝",
  long_time: "🏛️",
  mod_endorsed: "✅",
  weekly_mvp: "⭐",
};

export const BADGE_LABEL: Record<Badge, string> = {
  newcomer: "Newcomer",
  active: "Active member",
  long_time: "Long-time member",
  mod_endorsed: "Mod-endorsed",
  weekly_mvp: "Weekly MVP",
};

/** Score deltas applied by trigger handlers. */
export const SCORE = {
  POST: 3,
  COMMENT: 1,
  MOD_APPROVAL: 5,
  MOD_ENDORSEMENT: 25,
} as const;

export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  badges: Badge[];
};

export type InitResponse = {
  type: "init";
  postId: string;
  subredditName: string;
  username: string;
  isModerator: boolean;
  selfScore: number;
  selfBadges: Badge[];
  top: LeaderboardEntry[];
};

export type LeaderboardResponse = {
  type: "leaderboard";
  subredditName: string;
  top: LeaderboardEntry[];
};

export type EndorseRequest = {
  username: string;
};

export type EndorseResponse = {
  type: "endorse";
  username: string;
  score: number;
  badges: Badge[];
};

export type UserStatsResponse = {
  type: "user-stats";
  username: string;
  score: number;
  rank: number | null;
  badges: Badge[];
};

export const ApiEndpoint = {
  // Client HTTP routes
  Init: "/api/init",
  Leaderboard: "/api/leaderboard",
  Endorse: "/api/endorse",
  UserStats: "/api/user-stats",
  // Menu actions
  MenuPublishLeaderboard: "/internal/menu/publish-leaderboard",
  MenuEndorsePostAuthor: "/internal/menu/endorse-post-author",
  MenuEndorseCommenter: "/internal/menu/endorse-commenter",
  // Triggers
  TriggerAppInstall: "/internal/triggers/app-install",
  TriggerCommentCreate: "/internal/triggers/comment-create",
  TriggerPostCreate: "/internal/triggers/post-create",
  TriggerModAction: "/internal/triggers/mod-action",
  // Scheduler
  SchedulerWeeklyMvp: "/internal/scheduler/weekly-mvp",
} as const;
export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];

