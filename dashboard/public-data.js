// Both endpoints read existing app snapshots. No live station price requests.
const dashboardDataUrl = "https://verbrauch-push.simonkreis6289.workers.dev";
const dashboardBerlinTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
});

async function readDashboardJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function refreshDashboardData(load) {
  let nextRefresh = 0;
  let loading = false;
  async function refresh() {
    if (document.hidden || loading || Date.now() < nextRefresh) return;
    loading = true;
    try {
      await load();
    } finally {
      nextRefresh = Date.now() + 5 * 60 * 1000;
      loading = false;
    }
  }
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 30000);
  void refresh();
}
