import test from "node:test";
import assert from "node:assert/strict";
import { normalizeObservations } from "../js/spot-observations.js";

test("optional observations preserve local photo time and distinguish air from water temperature", () => {
  assert.deepEqual(normalizeObservations(), {});
  assert.deepEqual(normalizeObservations({ location: " Deschutes, above Steelhead Falls ", notes: "Clear water", photoDate: "2026-09-27", photoTime: "08:00", facing: "upstream", airTempF: "48", waterTempF: "55.5" }), {
    location: "Deschutes, above Steelhead Falls", notes: "Clear water", photoDate: "2026-09-27", photoTime: "08:00", facing: "upstream", airTempF: 48, waterTempF: 55.5,
  });
  assert.deepEqual(normalizeObservations({ photoTime: "08:00", airTempF: 0, waterTempF: "", notes: "  " }), { photoTime: "08:00", airTempF: 0 });
});

test("bad dates, impossible temperatures, oversized reports and unexpected fields are rejected", () => {
  for (const value of [null, [], { notes: "a".repeat(1601) }, { location: "a".repeat(201) }, { photoDate: "2026-02-30" }, { photoDate: "no date" }, { photoTime: "25:00" }, { facing: "north" }, { airTempF: true }, { airTempF: " " }, { waterTempF: 200 }, { airTempF: Infinity }, { photo: "unexpected" }]) assert.throws(() => normalizeObservations(value));
  assert.equal(normalizeObservations({ photoDate: "2024-02-29" }).photoDate, "2024-02-29");
});
