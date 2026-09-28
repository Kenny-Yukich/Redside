// Shared by the browser and Worker. No dependencies or build step.
export const ZONE_TITLES = ["Start here", "Work this next", "Third option"];
const SOURCES = ["photo", "overhead", "Redside data", "angler"];

export function gridCells(grid) {
  if (!grid || !((grid.columns === 6 && grid.rows === 4) ||
      (grid.columns === 4 && grid.rows === 6))) throw new Error("Invalid photo grid.");
  return Array.from({ length: grid.rows }, (_, row) =>
    Array.from({ length: grid.columns }, (_, col) => `${String.fromCharCode(65 + col)}${row + 1}`)).flat();
}

function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("Unexpected result fields.");
  }
}

function text(value, max = 1600) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error("Invalid result text.");
  }
}

function textList(value, min, max, length = 1600) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("Invalid result list.");
  value.forEach(item => text(item, length));
}

export function validateResult(result, grid, tackle) {
  const cells = gridCells(grid);
  if (result?.kind === "question") {
    object(result, ["kind", "question", "options"]);
    text(result.question, 700);
    textList(result.options, 2, 5, 180);
    if (new Set(result.options).size !== result.options.length) throw new Error("Duplicate answers.");
    return result;
  }
  object(result, ["kind", "zones", "fallback", "visible", "guesses"]);
  if (result.kind !== "plan" || !Array.isArray(result.zones) || result.zones.length !== 3) {
    throw new Error("A plan needs exactly three zones.");
  }
  const used = new Set();
  result.zones.forEach((zone, index) => {
    object(zone, ["id", "cell", "title", "tackle", "fromMyTackle", "aim", "technique", "reasons"]);
    if (zone.id !== index + 1 || zone.title !== ZONE_TITLES[index] ||
        !cells.includes(zone.cell) || used.has(zone.cell)) throw new Error("Invalid or overlapping zone.");
    used.add(zone.cell);
    text(zone.tackle, 300);
    if (typeof zone.fromMyTackle !== "boolean" || (zone.fromMyTackle && tackle && !tackle.includes(zone.tackle))) {
      throw new Error("Tackle does not match the angler's list.");
    }
    text(zone.aim);
    text(zone.technique);
    if (!Array.isArray(zone.reasons) || !zone.reasons.length || zone.reasons.length > 6) throw new Error("Invalid reasons.");
    zone.reasons.forEach(reason => {
      object(reason, ["source", "text"]);
      if (!SOURCES.includes(reason.source)) throw new Error("Unknown evidence source.");
      text(reason.text);
    });
  });
  text(result.fallback, 2400);
  textList(result.visible, 1, 10);
  textList(result.guesses, 1, 10);
  return result;
}

export function resultSchema(grid, includeAngler = false) {
  const string = (maxLength = 1600) => ({ type: "string", minLength: 1, maxLength });
  const list = (minItems, maxItems, maxLength) => ({
    type: "array", minItems, maxItems, items: string(maxLength),
  });
  const record = properties => ({
    type: "object", properties, required: Object.keys(properties), additionalProperties: false,
  });
  const zone = record({
    id: { type: "integer", enum: [1, 2, 3] },
    cell: { type: "string", enum: gridCells(grid) },
    title: { type: "string", enum: ZONE_TITLES },
    tackle: string(300),
    fromMyTackle: { type: "boolean", description: "True only when tackle exactly matches one item from the supplied tackle list." },
    aim: string(),
    technique: string(),
    reasons: { type: "array", minItems: 1, maxItems: 6, items: record({
      source: { type: "string", enum: includeAngler ? SOURCES : SOURCES.filter(source => source !== "angler") }, text: string(),
    }) },
  });
  return {
    type: "object",
    // Anthropic rejects top-level oneOf/anyOf/allOf in tool input schemas.
    // The discriminator and prompt select the shape; validateResult enforces
    // every required field and rejects mixed shapes before results are saved.
    properties: {
      kind: { type: "string", enum: ["plan", "question"], description: "For plan include only kind, zones, fallback, visible, guesses. For question include only kind, question, options." },
      zones: { type: "array", minItems: 3, maxItems: 3, items: zone },
      fallback: string(2400), visible: list(1, 10), guesses: list(1, 10),
      question: string(700), options: list(2, 5, 180),
    },
    required: ["kind"],
    additionalProperties: false,
  };
}
