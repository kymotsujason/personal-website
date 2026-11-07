// the captured frame sets' manifests, written by tools/capture-flat/pack.mjs. each piece is
// [frameX, frameY, w, h, atlasX, atlasY] in the set's own pixels, and a frame's shared list holds indexes into the
// manifest's shared pieces, which are drawn from another frame's atlas
const LIGHTINGS = ["day", "dusk", "night"];
const SIZES = ["full", "half"];
const SET_NAME = /^[a-z]+(?:-[a-z]+)*$/;

export const manifestFolder = (set, lighting, size) =>
  `/flat/${set}-${lighting}-${size}/`;

const isPiece = (piece) =>
  Array.isArray(piece) &&
  piece.length === 6 &&
  piece.every((v) => Number.isFinite(v));

// throws when the manifest isn't the set asked for or can't be drawn, so a bad file fails the load instead of a frame
export const checkManifest = (manifest, set, lighting, size) => {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`the ${set} manifest isn't an object`);
  }
  if (
    manifest.set !== set ||
    manifest.lighting !== lighting ||
    manifest.size !== size
  ) {
    throw new Error(
      `asked for ${set} ${lighting} ${size}, got ${manifest.set} ${manifest.lighting} ${manifest.size}`,
    );
  }
  const { window: view, margin, frames, shared } = manifest;
  if (
    !Number.isFinite(view?.width) ||
    !Number.isFinite(view?.height) ||
    !Number.isFinite(margin?.x) ||
    !Number.isFinite(margin?.top) ||
    !Number.isFinite(margin?.bottom)
  ) {
    throw new Error(`the ${set} manifest has no window or margin`);
  }
  if (!Array.isArray(shared) || !shared.every((s) => isPiece(s?.piece))) {
    throw new Error(`the ${set} manifest's shared pieces are malformed`);
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error(`the ${set} manifest has no frames`);
  }
  frames.forEach((frame, i) => {
    const sharedOk =
      Array.isArray(frame?.shared) &&
      frame.shared.every((k) => Number.isInteger(k) && shared[k] !== undefined);
    if (
      !Number.isFinite(frame?.fold) ||
      !Number.isFinite(frame.hand) ||
      !Array.isArray(frame.pieces) ||
      !frame.pieces.every(isPiece) ||
      (frame.pieces.length > 0 && typeof frame.atlas !== "string") ||
      !sharedOk
    ) {
      throw new Error(`the ${set} manifest's frame ${i} is malformed`);
    }
  });
  return manifest;
};

export const loadManifest = async (set, lighting, size) => {
  if (
    !SET_NAME.test(set) ||
    !LIGHTINGS.includes(lighting) ||
    !SIZES.includes(size)
  ) {
    throw new Error(`no frame set ${set} ${lighting} ${size}`);
  }
  const base = manifestFolder(set, lighting, size);
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) {
    throw new Error(`the ${set} manifest didn't load (${response.status})`);
  }
  const manifest = checkManifest(await response.json(), set, lighting, size);
  return { ...manifest, base };
};
