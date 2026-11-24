const themeButton = document.querySelector("#theme");
const fullscreenButton = document.querySelector("#fullscreen");
const fullscreenStatus = document.querySelector("#fullscreen-status");
const clock = document.querySelector("#clock");
const clockFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin"
});

function updateClock() {
  const now = new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = clockFormat.format(now);
}

function updateThemeButton() {
  const label = dashboardTheme === "dark" ? "Helles Design" : "Dunkles Design";
  themeButton.textContent = label;
}

themeButton.addEventListener("click", () => {
  dashboardTheme = dashboardTheme === "dark" ? "light" : "dark";
  dashboardRoot.dataset.theme = dashboardTheme;
  try {
    localStorage.setItem(dashboardThemeKey, dashboardTheme);
  } catch {
    // Keep the current theme for this visit.
  }
  updateThemeButton();
});

function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  const label = active ? "Vollbild beenden" : "Vollbild einschalten";
  fullscreenButton.title = label;
  fullscreenButton.setAttribute("aria-label", label);
  fullscreenButton.setAttribute("aria-pressed", String(active));
  fullscreenStatus.hidden = true;
}

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await dashboardRoot.requestFullscreen();
    }
  } catch {
    fullscreenStatus.textContent = "Vollbild ist in diesem Browserfenster nicht verfügbar.";
    fullscreenStatus.hidden = false;
  }
});
document.addEventListener("fullscreenchange", updateFullscreenButton);

updateThemeButton();
updateFullscreenButton();
updateClock();
setInterval(updateClock, 1000);
