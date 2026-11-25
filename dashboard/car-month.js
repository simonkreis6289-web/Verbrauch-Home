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

function bookingTime(entry) {
  return Date.parse(entry.toDate || entry.date);
}

function recordedBookings(entries, now) {
  return entries.filter(entry => Number.isFinite(bookingTime(entry)) && bookingTime(entry) <= now)
    .sort((a, b) => bookingTime(a) - bookingTime(b));
}

export function carMonthTotals(odometerEntries, period, now) {
  const pointsByDate = new Map();
  for (const entry of recordedBookings(odometerEntries, now)) {
    const time = bookingTime(entry);
    const mileage = recordedNumber(entry.mileage);
    if (mileage === null) continue;
    pointsByDate.set(time, Math.max(mileage, pointsByDate.get(time) ?? 0));
  }
  const points = [...pointsByDate];
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
    distance: covered ? distance : null,
    isEstimate,
    partial: covered > 0 && covered < period.end - period.start,
    coverage: Math.round(covered * 100 / (period.end - period.start))
  };
}

function transactionQuantity(entry, electric) {
  return recordedNumber(electric ? entry.kwh : entry.liters);
}

function transactionCost(entry, electric, quantity) {
  const total = recordedNumber(entry.totalPrice ?? (electric ? entry.electricityCost : null));
  if (total !== null) return total;
  const unitPrice = recordedNumber(electric ? entry.pricePerKwh : entry.pricePerLiter);
  return unitPrice !== null && quantity > 0 ? unitPrice * quantity : null;
}

export function carRunningCosts(entries, electric, period, now) {
  const bookings = recordedBookings(entries, now);
  const intervals = [];
  let previous;
  for (const entry of bookings) {
    const to = bookingTime(entry);
    const mileage = recordedNumber(entry.mileage);
    const quantity = transactionQuantity(entry, electric);
    // A missing odometer reading interrupts the chain of comparable bookings.
    const distance = previous && mileage !== null ? mileage - previous.mileage : 0;
    if (distance > 0 && to > previous.time && quantity > 0) {
      intervals.push({ from: previous.time, to, distance, quantity });
    }
    previous = mileage === null ? null : { time: to, mileage };
  }

  const monthIntervals = intervals.filter(({ from, to }) => from < period.end && to > period.start);
  const samples = monthIntervals.length ? monthIntervals : intervals.slice(-3);
  let quantity = 0;
  let distance = 0;
  for (const sample of samples) {
    const share = monthIntervals.length
      ? (Math.min(period.end, sample.to) - Math.max(period.start, sample.from)) / (sample.to - sample.from)
      : 1;
    quantity += sample.quantity * share;
    distance += sample.distance * share;
  }
  const consumption = distance > 0 ? quantity / distance * 100 : null;

  const prices = bookings.map(entry => {
    const amount = transactionQuantity(entry, electric);
    return { amount, cost: transactionCost(entry, electric, amount) };
  }).filter(({ amount, cost }) => amount > 0 && cost !== null).slice(-3);
  const unitPrice = prices.length
    ? prices.reduce((sum, item) => sum + item.cost, 0) / prices.reduce((sum, item) => sum + item.amount, 0)
    : null;
  const last = bookings.at(-1);
  const lastAmount = last ? transactionQuantity(last, electric) : null;
  return {
    consumption,
    costPer100km: consumption !== null && unitPrice !== null ? consumption * unitPrice : null,
    basedOnRecentIntervals: samples.length > 0 && monthIntervals.length === 0,
    last: last ? { time: bookingTime(last), amount: lastAmount, cost: transactionCost(last, electric, lastAmount) } : null
  };
}

export function nextInspection(service, now) {
  const last = recordedBookings(service.filter(entry => entry.category === "hu"), now).at(-1);
  return last?.nextDate ?? null;
}
