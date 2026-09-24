import { WATERS } from "./data.js";
import { cachedFor } from "./conditions.js";
import { scoreWater } from "./advisor.js";

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function nearestWater(lat, lon) {
  const ranked = WATERS.map(water => ({ water, distanceMeters: distanceMeters({ lat, lon }, water) })).sort((a, b) => a.distanceMeters - b.distanceMeters);
  return ranked[0]?.distanceMeters <= 2000 ? ranked[0] : { water: null, distanceMeters: null };
}
export function spotContext(lat, lon) {
  const nearest = nearestWater(lat, lon);
  return { water: nearest.water || "unknown water", distanceMeters: nearest.distanceMeters,
    biteScore: nearest.water ? scoreWater(nearest.water) : null,
    conditions: nearest.water ? cachedFor(nearest.water.id) : null, date: new Date().toISOString() };
}
export function destination(lat, lon, heading, meters = 65) {
  const rad = Math.PI / 180, angle = meters / 6371000, bearing = heading * rad, phi = lat * rad;
  const endLat = Math.asin(Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(bearing));
  const endLon = lon * rad + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(phi), Math.cos(angle) - Math.sin(phi) * Math.sin(endLat));
  return [endLat / rad, ((endLon / rad + 540) % 360) - 180];
}
export function bearingBetween(lat, lon, targetLat, targetLon) {
  const rad = Math.PI / 180, delta = (targetLon - lon) * rad;
  return (Math.atan2(Math.sin(delta) * Math.cos(targetLat * rad), Math.cos(lat * rad) * Math.sin(targetLat * rad) - Math.sin(lat * rad) * Math.cos(targetLat * rad) * Math.cos(delta)) / rad + 360) % 360;
}
