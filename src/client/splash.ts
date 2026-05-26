import { context, requestExpandedMode } from "@devvit/web/client";

const titleElement = document.getElementById("title") as HTMLHeadingElement;
const subtitleElement = document.getElementById(
  "subtitle",
) as HTMLParagraphElement;
const startButton = document.getElementById(
  "start-button",
) as HTMLButtonElement;

startButton.addEventListener("click", (e) => {
  requestExpandedMode(e, "game");
});

function init() {
  const sub = context.subredditName ?? "this community";
  titleElement.textContent = "🌟 GoodNeighbor";
  subtitleElement.textContent = `Celebrating the most helpful members of r/${sub}`;
}

init();

