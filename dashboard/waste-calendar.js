// Shared date selection for the dashboard and a later app view. Dates are local
// calendar days in Germany; never derive them from the TV's local timezone.
(function (root) {
  "use strict";
  const bins = [
    { type: "bio", label: "Braune Tonne", material: "Bio", color: "#a66c45" },
    { type: "residual", label: "Schwarze Tonne", material: "Restmüll", color: "#596273" },
    { type: "packaging", label: "Gelbe Tonne", material: "Verpackungen", color: "#eabd32" },
    { type: "paper", label: "Grüne Tonne", material: "Papier", color: "#43a978" }
  ];
  const berlinDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
  });
  function dayKey(now) {
    const parts = berlinDay.formatToParts(now);
    const value = name => parts.find(part => part.type === name).value;
    return value("year") + "-" + value("month") + "-" + value("day");
  }
  function dayNumber(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return NaN;
    const time = Date.parse(key + "T12:00:00Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key
      ? Math.floor(time / 86400000) : NaN;
  }
  function select(data, now = new Date(), specialDays = 14) {
    if (data?.schemaVersion !== 1 || !Array.isArray(data.events) ||
        !Number.isFinite(dayNumber(data.validFrom)) || !Number.isFinite(dayNumber(data.validThrough)) ||
        data.validFrom > data.validThrough) throw new Error("Ungültige Abfuhrdaten");
    const today = dayKey(now);
    const covered = today >= data.validFrom && today <= data.validThrough;
    const unique = new Map();
    data.events.forEach(event => {
      if (event && typeof event.type === "string" && Number.isFinite(dayNumber(event.date)) &&
          event.date >= today && event.date >= data.validFrom && event.date <= data.validThrough) {
        unique.set(event.date + "/" + event.type, event);
      }
    });
    const upcoming = covered ? [...unique.values()].sort((a, b) => a.date.localeCompare(b.date)) : [];
    const binDates = bins.map(bin => ({ ...bin, event: upcoming.find(event => event.type === bin.type) || null }));
    const nearest = binDates.map(bin => bin.event?.date).filter(Boolean).sort()[0];
    const regular = new Set(bins.map(bin => bin.type));
    const specials = upcoming.filter(event => !regular.has(event.type) &&
      dayNumber(event.date) - dayNumber(today) <= specialDays);
    return { today, covered, bins: binDates, specials, nearest };
  }
  const api = { bins, select, dayKey, dayNumber };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WasteCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
