import test from "node:test";
import assert from "node:assert/strict";
import { fitPhotoDimensions, gridForDimensions, cellCenter } from "../js/spot-media.js";

test("camera photos shrink to 1568px with aspect ratio preserved and never upscale", () => {
  assert.deepEqual(fitPhotoDimensions(4032, 3024), { width: 1568, height: 1176 });
  assert.deepEqual(fitPhotoDimensions(3024, 4032), { width: 1176, height: 1568 });
  assert.deepEqual(fitPhotoDimensions(640, 480), { width: 640, height: 480 });
  assert.throws(() => fitPhotoDimensions(0, 100), /invalid dimensions/);
});

test("landscape and portrait grids use the correct cell names and centers", () => {
  const landscape = gridForDimensions(1568, 1176);
  const portrait = gridForDimensions(1176, 1568);
  assert.deepEqual(landscape, { columns: 6, rows: 4 });
  assert.deepEqual(portrait, { columns: 4, rows: 6 });
  assert.deepEqual(cellCenter("A1", landscape), { x: 1 / 12, y: 1 / 8 });
  assert.deepEqual(cellCenter("F4", landscape), { x: 11 / 12, y: 7 / 8 });
  assert.deepEqual(cellCenter("D6", portrait), { x: 7 / 8, y: 11 / 12 });
  assert.deepEqual(cellCenter(" a1 ", portrait), { x: 1 / 8, y: 1 / 12 });
  assert.throws(() => cellCenter("E4", portrait), /outside/);
  assert.throws(() => cellCenter("A5", landscape), /outside/);
  assert.throws(() => cellCenter("A0", landscape), /outside/);
  assert.throws(() => cellCenter("A1<script>", landscape), /invalid/);
});
