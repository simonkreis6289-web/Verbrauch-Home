const themeButton = document.querySelector("#theme");
const fullscreenButton = document.querySelector("#fullscreen");
const fullscreenStatus = document.querySelector("#fullscreen-status");
const clock = document.querySelector("#clock");
const chart = document.querySelector("#temperatures");
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
  drawTemperatures();
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

const indoor = [21, 21.3, 21.2, 21.1, 21, 20.9, 21.2, 21, 21.1, 21.6, 21.3, 21.4, 21.5, 21.4, 21.6, 21.4, 21.2, 21.3, 21.5, 21.4, 21.7, 21.6, 21.4, 21.3];
const outdoor = [6.4, 6, 6.1, 5.8, 5.8, 6, 6.2, 6.1, 6.8, 7.3, 7.9, 8.4, 9, 8.8, 9.1, 9.4, 9.5, 9.3, 8.9, 8.8, 8.2, 7.8, 7.1, 6.8];

function drawTemperatures() {
  const { width, height } = chart.getBoundingClientRect();
  if (width < 45 || height < 40) return;
  const scale = window.devicePixelRatio || 1;
  chart.width = Math.round(width * scale);
  chart.height = Math.round(height * scale);
  const context = chart.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  const style = getComputedStyle(dashboardRoot);
  const y = value => 9 + (24 - value) / 20 * (height - 30);
  const x = hour => 35 + hour / 23 * (width - 43);

  context.font = "11px system-ui";
  context.textBaseline = "middle";
  for (const value of [4, 8, 12, 16, 20, 24]) {
    context.fillStyle = style.getPropertyValue("--muted");
    context.fillText(value + " °C", 0, y(value));
    context.strokeStyle = style.getPropertyValue("--line");
    context.beginPath();
    context.moveTo(x(0), y(value));
    context.lineTo(x(23), y(value));
    context.stroke();
  }

  for (const hour of [0, 6, 12, 18, 23]) {
    context.textAlign = hour === 23 ? "right" : "left";
    context.fillText(String(hour).padStart(2, "0") + ":00", x(hour), height - 7);
  }

  for (const [series, color] of [[indoor, "--warm"], [outdoor, "--primary"]]) {
    context.strokeStyle = style.getPropertyValue(color);
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(x(0), y(series[0]));
    series.slice(1).forEach((value, index) => context.lineTo(x(index + 1), y(value)));
    context.stroke();
  }
}

updateThemeButton();
updateFullscreenButton();
updateClock();
setInterval(updateClock, 1000);
drawTemperatures();
if ("ResizeObserver" in window) {
  new ResizeObserver(drawTemperatures).observe(chart);
} else {
  window.addEventListener("resize", drawTemperatures);
}
