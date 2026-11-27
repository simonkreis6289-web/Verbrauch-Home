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

const houseStock = document.querySelector(".house-stock");
if (houseStock) {
  const scene = houseStock.parentElement;

  function fitHouseStock() {
    const width = scene.clientWidth;
    const height = scene.clientHeight;
    if (!width || !height) return;

    // The 2:1 drawing uses background-size: cover, centered and aligned to the bottom.
    // These fractions locate the inner basement walls in house.webp.
    const imageWidth = Math.max(width, height * 2);
    const imageHeight = imageWidth / 2;
    const imageLeft = (width - imageWidth) / 2;
    const imageTop = height - imageHeight;
    const overlay = scene.querySelector(".heat-overlay");
    Object.assign(overlay.style,{left:imageLeft+"px",top:imageTop+"px",width:imageWidth+"px",height:imageHeight+"px"});
    const left = Math.max(0, imageLeft + imageWidth * .33);
    const right = Math.min(width, imageLeft + imageWidth * .452);
    const top = Math.max(0, imageTop + imageHeight * .765);
    const bottom = height - imageHeight * .06;
    const roomWidth = right - left;
    const roomHeight = bottom - top;

    houseStock.hidden = roomWidth <= 0 || roomHeight <= 2;
    if (houseStock.hidden) return;

    houseStock.style.left = left + "px";
    houseStock.style.bottom = (height - bottom) + "px";
    houseStock.style.width = roomWidth + "px";
    houseStock.style.maxHeight = roomHeight + "px";
    houseStock.style.height = roomHeight + "px";
    houseStock.style.fontSize = Math.min(20, roomWidth / 9, (roomHeight - 2) / 4.15) + "px";
  }

  fitHouseStock();
  if ("ResizeObserver" in window) {
    const houseObserver = new ResizeObserver(fitHouseStock);
    houseObserver.observe(scene);
  } else {
    window.addEventListener("resize", fitHouseStock);
    document.addEventListener("fullscreenchange", fitHouseStock);
  }
}

// Fit the complete overview, including dynamically loaded content, without clipping.
const overview = document.querySelector('.tv-grid');
const main = document.querySelector('main');
let fitFrame;
function fitOverview() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    overview.style.transform = ''; overview.style.width = ''; overview.style.height = '';
    if (window.innerWidth < 900 || window.innerHeight < 500) return;
    const available = main.clientHeight - 12;
    let scale = 1;
    for (let i=0;i<4;i++) {
      overview.style.width = (100/scale)+'%';
      overview.style.height = (available/scale)+'px';
      const needed = Math.max(overview.scrollHeight, overview.offsetHeight);
      if (needed*scale <= available+1) break;
      scale = Math.min(scale, available/needed);
    }
    overview.style.transform = 'scale('+scale+')';
  });
}
window.addEventListener('resize', fitOverview);
document.addEventListener('fullscreenchange', fitOverview);
new MutationObserver(fitOverview).observe(overview,{childList:true,subtree:true,characterData:true});
fitOverview();
