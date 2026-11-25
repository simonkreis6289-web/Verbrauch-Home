const berlinParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const monthName = new Intl.DateTimeFormat("de-DE", {
  month: "long", year: "numeric", timeZone: "Europe/Berlin"
});

function berlinMonthStart(year, monthIndex) {
  const utc = Date.UTC(year, monthIndex, 1);
  const local = Object.fromEntries(berlinParts.formatToParts(utc).map(part => [part.type, Number(part.value)]));
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return utc - (localAsUtc - utc);
}

export function previousCarMonth(now) {
  const parts = Object.fromEntries(berlinParts.formatToParts(now).map(part => [part.type, Number(part.value)]));
  const start = berlinMonthStart(parts.year, parts.month - 2);
  return { start, end: berlinMonthStart(parts.year, parts.month - 1), label: monthName.format(start) };
}

function recordedNumber(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value) : null;
}

export function carMonthTotals(transactions, odometerEntries, period, now) {
  const dateOf = entry => Date.parse(entry.toDate || entry.date);
  const bookings = transactions.filter(entry => dateOf(entry) >= period.start && dateOf(entry) < period.end);
  const prices = bookings.map(entry => recordedNumber(entry.totalPrice)).filter(value => value !== null);
  const pointsByDate = new Map();
  for (const entry of odometerEntries) {
    const time = dateOf(entry);
    const mileage = recordedNumber(entry.mileage);
    if (!Number.isFinite(time) || time > now || mileage === null) continue;
    pointsByDate.set(time, Math.max(mileage, pointsByDate.get(time) ?? 0));
  }
  const points = [...pointsByDate].sort(([a], [b]) => a - b);
  let covered = 0;
  let distance = 0;
  let isEstimate = false;
  for (let i = 1; i < points.length; i++) {
    const [from, first] = points[i - 1];
    const [to, last] = points[i];
    const overlap = Math.min(period.end, to) - Math.max(period.start, from);
    if (overlap <= 0 || last < first) continue;
    covered += overlap;
    distance += (last - first) * (overlap / (to - from));
    isEstimate ||= overlap !== to - from;
  }
  return {
    mileage: points.at(-1)?.[1] ?? null,
    cost: prices.length ? prices.reduce((sum, value) => sum + value, 0) : null,
    bookingCount: bookings.length,
    pricedCount: prices.length,
    distance: covered ? Math.round(distance) : null,
    isEstimate,
    partial: covered > 0 && covered < period.end - period.start,
    coverage: Math.round(covered * 100 / (period.end - period.start))
  };
}
