// Native image decoding handles photo orientation. We never inspect EXIF,
// including GPS metadata. Redrawing into canvas removes the source metadata.
const LONG_EDGE = 1568;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const LABELS = ["Start here", "Work this next", "Third option"];

export function fitPhotoDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("That photo has invalid dimensions.");
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function gridForDimensions(width, height) {
  return height > width ? { columns: 4, rows: 6 } : { columns: 6, rows: 4 };
}

export function cellCenter(cell, grid) {
  const match = typeof cell === "string" && /^([A-Z])(\d+)$/.exec(cell.trim().toUpperCase());
  if (!match || !Number.isInteger(grid?.columns) || !Number.isInteger(grid?.rows) ||
      grid.columns < 1 || grid.columns > 26 || grid.rows < 1) {
    throw new Error("The analysis contains an invalid photo grid cell.");
  }
  const column = match[1].charCodeAt(0) - 65;
  const row = Number(match[2]) - 1;
  if (column >= grid.columns || row < 0 || row >= grid.rows) {
    throw new Error("The analysis points outside this photo's grid.");
  }
  return { x: (column + 0.5) / grid.columns, y: (row + 0.5) / grid.rows };
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare this photo. Close other tabs and try again.");
  return { canvas, context };
}

function releaseCanvas(canvas) {
  // Explicitly release backing stores on iOS, where canvas memory is limited.
  canvas.width = 0;
  canvas.height = 0;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob
      ? resolve(blob)
      : reject(new Error("Your browser ran out of memory preparing the photo. Try a smaller image.")), type, quality);
  });
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const url = URL.createObjectURL(blob);
    const release = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      release();
      reject(new Error("This photo took too long to open. Try a smaller photo or a JPEG copy."));
    }, 30000);
    image.onload = () => {
      clearTimeout(timer);
      if (!image.naturalWidth || !image.naturalHeight) {
        release();
        reject(new Error("That image has no usable photo dimensions."));
        return;
      }
      resolve({ image, release });
    };
    image.onerror = () => {
      clearTimeout(timer);
      release();
      reject(new Error("This browser could not open that photo. Try a JPEG or PNG copy."));
    };
    image.src = url;
  });
}

function drawGrid(context, width, height, grid) {
  const cellWidth = width / grid.columns;
  const cellHeight = height / grid.rows;
  const lineWidth = Math.max(1, Math.min(width, height) / 700);
  context.save();
  context.beginPath();
  for (let column = 1; column < grid.columns; column++) {
    context.moveTo(column * cellWidth, 0);
    context.lineTo(column * cellWidth, height);
  }
  for (let row = 1; row < grid.rows; row++) {
    context.moveTo(0, row * cellHeight);
    context.lineTo(width, row * cellHeight);
  }
  context.strokeStyle = "rgba(0,0,0,0.8)";
  context.lineWidth = lineWidth * 3;
  context.stroke();
  context.strokeStyle = "rgba(255,255,255,0.95)";
  context.lineWidth = lineWidth;
  context.stroke();
  const fontSize = Math.max(10, Math.min(30, cellWidth / 7, cellHeight / 6));
  const padding = Math.max(3, fontSize / 4);
  context.font = `700 ${fontSize}px sans-serif`;
  context.textBaseline = "top";
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const label = `${String.fromCharCode(65 + column)}${row + 1}`;
      const x = column * cellWidth + padding;
      const y = row * cellHeight + padding;
      const labelWidth = context.measureText(label).width;
      context.fillStyle = "rgba(0,0,0,0.85)";
      context.fillRect(x, y, labelWidth + 2 * padding, fontSize + 2 * padding);
      context.fillStyle = "#fff";
      context.fillText(label, x + padding, y + padding);
    }
  }
  context.restore();
}

export async function preparePhoto(file) {
  if (!(file instanceof Blob) || !file.size) throw new Error("Choose a photo first.");
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose an image from your camera or photo library.");
  if (file.size > MAX_FILE_BYTES) throw new Error("That photo is over 50 MB. Choose a smaller version.");
  const { image, release } = await loadImage(file);
  let canvas;
  try {
    const { width, height } = fitPhotoDimensions(image.naturalWidth, image.naturalHeight);
    const grid = gridForDimensions(width, height);
    const surface = makeCanvas(width, height);
    canvas = surface.canvas;
    const context = surface.context;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    release();
    // Serialize the clean pixels before drawing on this working copy.
    const photo = await toBlob(canvas, "image/jpeg", 0.8);
    drawGrid(context, width, height, grid);
    const griddedPhoto = await toBlob(canvas, "image/jpeg", 0.8);
    return { photo, griddedPhoto, grid, width, height };
  } finally {
    release();
    if (canvas) releaseCanvas(canvas);
  }
}

export function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("This saved photo could not be read. Try selecting it again."));
    reader.onabort = () => reject(new Error("Reading this photo was interrupted."));
    reader.readAsDataURL(blob);
  });
}

export async function annotatePhoto(photoBlob, result, grid, {
  includeLocation = false, waterName = "", lat, lon,
} = {}) {
  if (!Array.isArray(result?.zones) || result.zones.length !== 3) {
    throw new Error("A photo plan needs three zones before it can be shared.");
  }
  const centers = result.zones.map((zone) => cellCenter(zone.cell, grid));
  const { image, release } = await loadImage(photoBlob);
  let canvas;
  try {
    const { width, height } = fitPhotoDimensions(image.naturalWidth, image.naturalHeight);
    const fontSize = Math.max(10, Math.min(28, width / 30));
    const lineHeight = Math.ceil(fontSize * 1.55);
    const padding = Math.ceil(fontSize * 0.7);
    const location = includeLocation ? [
      String(waterName || "").trim().slice(0, 100),
      Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "",
    ].filter(Boolean) : [];
    const footerHeight = 2 * padding + lineHeight * (4 + location.length);
    const surface = makeCanvas(width, height + footerHeight);
    canvas = surface.canvas;
    const context = surface.context;
    context.drawImage(image, 0, 0, width, height);
    release();
    const radius = Math.max(10, Math.min(width / grid.columns, height / grid.rows) * 0.14);
    centers.forEach(({ x, y }, index) => {
      context.beginPath();
      context.arc(x * width, y * height, radius, 0, Math.PI * 2);
      context.fillStyle = "#123b3d";
      context.fill();
      context.strokeStyle = "#fff";
      context.lineWidth = Math.max(2, radius / 8);
      context.stroke();
      context.fillStyle = "#fff";
      context.font = `700 ${Math.round(radius * 1.2)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x * width, y * height + radius * 0.04);
    });
    context.fillStyle = "#123b3d";
    context.fillRect(0, height, width, footerHeight);
    context.fillStyle = "#fff";
    context.textAlign = "left";
    context.textBaseline = "top";
    const lines = ["REDSIDE · Fish This Spot", ...LABELS.map((label, index) => `${index + 1}  ${label}`), ...location];
    lines.forEach((line, index) => {
      context.font = `${index === 0 ? "700" : "400"} ${fontSize}px sans-serif`;
      context.fillText(line, padding, height + padding + index * lineHeight, width - 2 * padding);
    });
    return await toBlob(canvas, "image/png");
  } finally {
    release();
    if (canvas) releaseCanvas(canvas);
  }
}
