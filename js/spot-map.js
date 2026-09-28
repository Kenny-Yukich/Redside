import { destination, bearingBetween } from "./spot-context.js";

let leafletPromise;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    script.crossOrigin = "anonymous";
    const timer = setTimeout(() => script.onerror(), 15000);
    script.onload = () => { clearTimeout(timer); resolve(window.L); };
    script.onerror = () => { clearTimeout(timer); script.remove(); leafletPromise = null; reject(new Error("Map library unavailable. Reconnect to load satellite imagery.")); };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

export async function mountSpotMap(container, { lat, lon, heading, token, onPosition, onHeading, onError }) {
  const L = await loadLeaflet();
  if (!container.isConnected) return null;
  const map = L.map(container, { zoomControl: true }).setView([lat, lon], 17);
  const tiles = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`, {
    tileSize: 512, zoomOffset: -1, maxZoom: 20, referrerPolicy: "no-referrer-when-downgrade",
    attribution: '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://apps.mapbox.com/feedback/">Improve this map</a>',
  }).addTo(map);
  const tileTimer = setTimeout(() => onError("Satellite imagery is taking too long to load. Check your connection and retry the map."), 20000);
  tiles.on("tileload", () => clearTimeout(tileTimer));
  tiles.on("tileerror", () => onError("Mapbox could not load satellite imagery. Check your connection and the public map token in Settings. The token needs styles:tiles permission and must allow this website's address."));
  const pin = L.marker([lat, lon], { draggable: true, title: "Photo position: drag to move", icon: L.divIcon({ className: "spot-pin", html: '<span aria-hidden="true">●</span>', iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(map);
  const arrow = L.marker(destination(lat, lon, heading || 0), { draggable: true, title: "Facing direction: drag this arrow", icon: L.divIcon({ className: "spot-arrow", html: '<span aria-hidden="true">➤</span>', iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map);
  const line = L.polyline([pin.getLatLng(), arrow.getLatLng()], { color: "#f9d76c", weight: 4 }).addTo(map);
  const update = (nextLat, nextLon, nextHeading, pan = false) => {
    lat = nextLat; lon = nextLon; heading = nextHeading;
    pin.setLatLng([lat, lon]);
    arrow.setLatLng(destination(lat, lon, heading || 0));
    line.setLatLngs([pin.getLatLng(), arrow.getLatLng()]);
    const icon = arrow.getElement()?.firstElementChild;
    if (icon) icon.style.transform = `rotate(${(heading || 0) - 90}deg)`;
    if (pan) map.panTo([lat, lon]);
  };
  pin.on("drag", () => { const position = pin.getLatLng(); update(position.lat, position.lng, heading); onPosition(lat, lon); });
  map.on("click", event => { update(event.latlng.lat, event.latlng.lng, heading); onPosition(lat, lon); });
  arrow.on("drag", () => {
    const point = arrow.getLatLng();
    heading = bearingBetween(lat, lon, point.lat, point.lng);
    line.setLatLngs([pin.getLatLng(), point]);
    const icon = arrow.getElement()?.firstElementChild;
    if (icon) icon.style.transform = `rotate(${heading - 90}deg)`;
    onHeading(heading);
  });
  arrow.on("dragend", () => update(lat, lon, heading));
  update(lat, lon, heading);
  requestAnimationFrame(() => map.invalidateSize());
  return { update, remove: () => { clearTimeout(tileTimer); map.remove(); } };
}
