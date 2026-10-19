import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { scanMetadata } from "../../../../tools/privacy/metadata.mjs";
import recorded from "../data/keys.sha256.json";

const publicFile = (path) =>
  readFileSync(new URL(`../../public/${path}`, import.meta.url));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const idatBytes = (png) => {
  const parts = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (type === "IDAT") {
      parts.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  return Buffer.concat(parts);
};

test("the recorded list names the four keys and the rig", () => {
  expect(Object.keys(recorded).sort()).toEqual([
    "keys/landscape-baked.json",
    "keys/pinch.json",
    "keys/portrait-grips.json",
    "keys/support.json",
    "models/hands-rig.json",
  ]);
});

for (const [path, hash] of Object.entries(recorded)) {
  test(`${path} matches its recorded hash`, () => {
    expect(sha256(publicFile(path))).toBe(hash);
  });
}

test("the small wall mask has no metadata chunks", () => {
  const name = "desk-wall-mask-small.png";
  expect(scanMetadata(publicFile(name), name)).toEqual([]);
});

test("stripping the small wall mask left its pixel data alone", () => {
  // sha256 of the IDAT payloads in the spike's original file, before the tEXt and tIME chunks were stripped
  const originalIdat =
    "b2261fddc4bfa75d345958fc1eee78dc73e0906133fe7560bee6b86e181a7e0d";
  expect(sha256(idatBytes(publicFile("desk-wall-mask-small.png")))).toBe(
    originalIdat,
  );
});
