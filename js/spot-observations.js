// Optional angler reports. Dates and times are local to the fishing spot;
// they are deliberately not converted using the computer's current timezone.
const TEXT_FIELDS = { location: 200, notes: 1600, photoDate: 10, photoTime: 5, facing: 20 };
const TEMPERATURES = { airTempF: [-80, 140], waterTempF: [28, 120] };
export const OBSERVATION_FIELDS = [...Object.keys(TEXT_FIELDS), ...Object.keys(TEMPERATURES)];
export const FACING_LABELS = { upstream: "Upstream", downstream: "Downstream", across: "Across the water", unsure: "Not sure" };

export function normalizeObservations(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !OBSERVATION_FIELDS.includes(key))) {
    throw new Error("Check the details about your fishing spot.");
  }
  const result = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (value[key] === undefined || value[key] === "") continue;
    if (typeof value[key] !== "string" || value[key].length > max) throw new Error(`Keep ${key === "notes" ? "spot notes" : "spot details"} within ${max} characters.`);
    if (value[key].trim()) result[key] = value[key].trim();
  }
  if (result.photoDate && (!/^\d{4}-\d{2}-\d{2}$/.test(result.photoDate) || !Number.isFinite(Date.parse(`${result.photoDate}T00:00:00Z`)) || new Date(`${result.photoDate}T00:00:00Z`).toISOString().slice(0, 10) !== result.photoDate)) {
    throw new Error("Choose a valid photo date.");
  }
  if (result.photoTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result.photoTime)) throw new Error("Choose a valid photo time.");
  if (result.facing && !Object.hasOwn(FACING_LABELS, result.facing)) throw new Error("Choose upstream, downstream, across, or not sure.");
  for (const [key, [low, high]] of Object.entries(TEMPERATURES)) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    const number = typeof value[key] === "number" ? value[key] : typeof value[key] === "string" && value[key].trim() ? Number(value[key]) : NaN;
    if (!Number.isFinite(number) || number < low || number > high) throw new Error(`Enter ${key === "airTempF" ? "air" : "water"} temperature between ${low} and ${high} °F, or leave it blank.`);
    result[key] = number;
  }
  return result;
}
