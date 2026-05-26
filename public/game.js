// src/shared/api.ts
var BADGE_EMOJI = {
  newcomer: "\u{1F331}",
  active: "\u{1F91D}",
  long_time: "\u{1F3DB}\uFE0F",
  mod_endorsed: "\u2705",
  weekly_mvp: "\u2B50"
};
var BADGE_LABEL = {
  newcomer: "Newcomer",
  active: "Active member",
  long_time: "Long-time member",
  mod_endorsed: "Mod-endorsed",
  weekly_mvp: "Weekly MVP"
};
var ApiEndpoint = {
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
  SchedulerWeeklyMvp: "/internal/scheduler/weekly-mvp"
};

// src/client/game.ts
var titleElement = document.getElementById("title");
var subtitleElement = document.getElementById(
  "subtitle"
);
var selfStatsElement = document.getElementById(
  "self-stats"
);
var leaderboardElement = document.getElementById(
  "leaderboard"
);
var refreshButton = document.getElementById(
  "refresh-button"
);
var endorseRow = document.getElementById("endorse-row");
var endorseInput = document.getElementById(
  "endorse-input"
);
var endorseButton = document.getElementById(
  "endorse-button"
);
var toastElement = document.getElementById("toast");
var isModerator = false;
function showToast(text, kind = "success") {
  toastElement.textContent = text;
  toastElement.dataset["kind"] = kind;
  toastElement.classList.add("toast--visible");
  window.setTimeout(() => {
    toastElement.classList.remove("toast--visible");
  }, 2400);
}
function badgePill(b) {
  return `<span class="badge" title="${BADGE_LABEL[b]}">${BADGE_EMOJI[b]}</span>`;
}
function renderLeaderboard(top) {
  leaderboardElement.innerHTML = "";
  if (top.length === 0) {
    const li = document.createElement("li");
    li.className = "row row--empty";
    li.textContent = "No contributors yet. Be the first \u{1F44B}";
    leaderboardElement.appendChild(li);
    return;
  }
  for (const entry of top) {
    const li = document.createElement("li");
    li.className = "row";
    li.innerHTML = `
      <span class="row__rank">${entry.rank}</span>
      <span class="row__user">u/${escapeHtml(entry.username)}</span>
      <span class="row__badges">${entry.badges.map(badgePill).join("")}</span>
      <span class="row__score">${entry.score}</span>
      ${isModerator ? `<button class="row__endorse" data-user="${escapeHtml(
      entry.username
    )}">Endorse</button>` : ""}
    `;
    leaderboardElement.appendChild(li);
  }
  if (isModerator) {
    leaderboardElement.querySelectorAll("button.row__endorse").forEach((btn) => {
      btn.addEventListener("click", () => {
        const user = btn.dataset["user"];
        if (user) void endorse(user);
      });
    });
  }
}
function renderSelfStats(data) {
  const badges = data.selfBadges.map(badgePill).join("") || "\u2014";
  selfStatsElement.innerHTML = `
    <span class="self-stats__label">Your score in r/${escapeHtml(
    data.subredditName
  )}:</span>
    <span class="self-stats__score">${data.selfScore}</span>
    <span class="self-stats__badges">${badges}</span>
  `;
}
async function loadInitial() {
  try {
    const rsp = await fetch(ApiEndpoint.Init);
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = await rsp.json();
    isModerator = data.isModerator;
    titleElement.textContent = `GoodNeighbor \u2014 r/${data.subredditName}`;
    subtitleElement.textContent = `Hey u/${data.username} \u{1F44B} \u2014 top contributors this week`;
    endorseRow.style.display = isModerator ? "flex" : "none";
    renderSelfStats(data);
    renderLeaderboard(data.top);
  } catch (err) {
    console.error("init failed", err);
    showToast("Failed to load leaderboard", "error");
  }
}
async function refreshLeaderboard() {
  try {
    const rsp = await fetch(ApiEndpoint.Leaderboard);
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = await rsp.json();
    renderLeaderboard(data.top);
    showToast("Leaderboard refreshed");
  } catch (err) {
    console.error("refresh failed", err);
    showToast("Refresh failed", "error");
  }
}
async function endorse(username) {
  try {
    const rsp = await fetch(ApiEndpoint.Endorse, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = await rsp.json();
    showToast(`Endorsed u/${data.username} \u2014 ${data.score} pts`);
    await refreshLeaderboard();
  } catch (err) {
    console.error("endorse failed", err);
    showToast("Endorse failed", "error");
  }
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
refreshButton.addEventListener("click", () => void refreshLeaderboard());
endorseButton.addEventListener("click", () => {
  const u = endorseInput.value.trim().replace(/^u\//, "");
  if (!u) {
    showToast("Enter a username", "error");
    return;
  }
  void endorse(u);
  endorseInput.value = "";
});
endorseInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") endorseButton.click();
});
void loadInitial();
//# sourceMappingURL=game.js.map
