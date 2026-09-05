// Shared by the browser and server: reservation dates are Japanese calendar dates.
const japanDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** @param {Date} [now] */
export function getJapanDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError("A valid instant is required.");
  }
  const parts = japanDateFormatter.formatToParts(now);
  const part = (/** @type {string} */ type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** @param {unknown} value */
export function isValidReservationDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Classifies the request only; it does not grant approval or reserve a seat.
 * The whole prior day (through 23:59:59.999 JST) is advance submission.
 * @param {string} reservationDate
 * @param {Date} [now]
 * @returns {"past" | "same_day" | "advance"}
 */
export function getReservationRequestKind(reservationDate, now = new Date()) {
  if (!isValidReservationDate(reservationDate)) throw new RangeError("Invalid reservation date.");
  const today = getJapanDate(now);
  return reservationDate < today ? "past" : reservationDate === today ? "same_day" : "advance";
}
