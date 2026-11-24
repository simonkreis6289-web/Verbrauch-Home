// Read the app preference as the initial default and save changes for this dashboard.
const dashboardThemeKey = "verbrauch-dashboard-theme-v1";
const dashboardRoot = document.documentElement;
let dashboardTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

try {
  const savedTheme = localStorage.getItem(dashboardThemeKey) ?? localStorage.getItem("verbrauch-theme-v1");
  if (savedTheme === "light" || savedTheme === "dark") dashboardTheme = savedTheme;
} catch {
  // The dashboard also works when browser storage is disabled.
}

dashboardRoot.dataset.theme = dashboardTheme;
