import {
  ApiEndpoint,
  BADGE_EMOJI,
  BADGE_LABEL,
  type Badge,
  type EndorseRequest,
  type EndorseResponse,
  type InitResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "../shared/api.ts";

const titleElement = document.getElementById("title") as HTMLHeadingElement;
const subtitleElement = document.getElementById(
  "subtitle",
) as HTMLParagraphElement;
const selfStatsElement = document.getElementById(
  "self-stats",
) as HTMLDivElement;
const leaderboardElement = document.getElementById(
  "leaderboard",
) as HTMLOListElement;
const refreshButton = document.getElementById(
  "refresh-button",
) as HTMLButtonElement;
const endorseRow = document.getElementById("endorse-row") as HTMLDivElement;
const endorseInput = document.getElementById(
  "endorse-input",
) as HTMLInputElement;
const endorseButton = document.getElementById(
  "endorse-button",
) as HTMLButtonElement;
const toastElement = document.getElementById("toast") as HTMLDivElement;

let isModerator = false;

function showToast(text: string, kind: "success" | "error" = "success"): void {
  toastElement.textContent = text;
  toastElement.dataset["kind"] = kind;
  toastElement.classList.add("toast--visible");
  window.setTimeout(() => {
    toastElement.classList.remove("toast--visible");
  }, 2400);
}

function badgePill(b: Badge): string {
  return `<span class="badge" title="${BADGE_LABEL[b]}">${BADGE_EMOJI[b]}</span>`;
}

function renderLeaderboard(top: LeaderboardEntry[]): void {
  leaderboardElement.innerHTML = "";
  if (top.length === 0) {
    const li = document.createElement("li");
    li.className = "row row--empty";
    li.textContent = "No contributors yet. Be the first 👋";
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
      ${
        isModerator
          ? `<button class="row__endorse" data-user="${escapeHtml(
              entry.username,
            )}">Endorse</button>`
          : ""
      }
    `;
    leaderboardElement.appendChild(li);
  }
  if (isModerator) {
    leaderboardElement
      .querySelectorAll<HTMLButtonElement>("button.row__endorse")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const user = btn.dataset["user"];
          if (user) void endorse(user);
        });
      });
  }
}

function renderSelfStats(data: InitResponse): void {
  const badges = data.selfBadges.map(badgePill).join("") || "—";
  selfStatsElement.innerHTML = `
    <span class="self-stats__label">Your score in r/${escapeHtml(
      data.subredditName,
    )}:</span>
    <span class="self-stats__score">${data.selfScore}</span>
    <span class="self-stats__badges">${badges}</span>
  `;
}

async function loadInitial(): Promise<void> {
  try {
    const rsp = await fetch(ApiEndpoint.Init);
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = (await rsp.json()) as InitResponse;
    isModerator = data.isModerator;
    titleElement.textContent = `GoodNeighbor — r/${data.subredditName}`;
    subtitleElement.textContent = `Hey u/${data.username} 👋 — top contributors this week`;
    endorseRow.style.display = isModerator ? "flex" : "none";
    renderSelfStats(data);
    renderLeaderboard(data.top);
  } catch (err) {
    console.error("init failed", err);
    showToast("Failed to load leaderboard", "error");
  }
}

async function refreshLeaderboard(): Promise<void> {
  try {
    const rsp = await fetch(ApiEndpoint.Leaderboard);
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = (await rsp.json()) as LeaderboardResponse;
    renderLeaderboard(data.top);
    showToast("Leaderboard refreshed");
  } catch (err) {
    console.error("refresh failed", err);
    showToast("Refresh failed", "error");
  }
}

async function endorse(username: string): Promise<void> {
  try {
    const rsp = await fetch(ApiEndpoint.Endorse, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username } satisfies EndorseRequest),
    });
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
    const data = (await rsp.json()) as EndorseResponse;
    showToast(`Endorsed u/${data.username} — ${data.score} pts`);
    await refreshLeaderboard();
  } catch (err) {
    console.error("endorse failed", err);
    showToast("Endorse failed", "error");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

