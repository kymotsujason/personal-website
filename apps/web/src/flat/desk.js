// the desk behind the phone: the 3d desk's cube faces, captured through a 90 degree camera sharp and blurred
// (tools/capture-flat), each warped with matrix3d to where the 3d desk camera sees it. the blurred faces lie over the
// sharp ones and fade in as the phone opens, standing in for the 3d desk's blur. only the faces the resting view
// reaches are shown, and the look (turning the view) builds on deskQuads
import { DESK_FOV, DESK_REST_PITCH } from "../scene/shared/motion.js";
import { quadToQuad } from "./warp.js";

const TAN_HALF = Math.tan((DESK_FOV / 2) * (Math.PI / 180));
const DESK_NAME = /^desk-(day|dusk|night)-(full|half)$/;
// the faces the view reaches at rest, drawn in this order so the front lies over the seams with its neighbors
const RESTING_FACES = ["left", "right", "front"];
const LOOKS = ["sharp", "blur"];

const cross = ([ax, ay, az], [bx, by, bz]) => [
  ay * bz - az * by,
  az * bx - ax * bz,
  ax * by - ay * bx,
];

// a world direction as the desk camera sees it. backdrop.js turns that camera with three's YXZ order (rotation x by
// pitch, y by -yaw), so the view yaws about the world's up and then tilts about its own sideways axis. lonSpan's
// comment there describes the other order, but the camera renders with this one
const toCamera = ([x, y, z], yaw, pitch) => {
  const x1 = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const z1 = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return [
    x1,
    Math.cos(pitch) * y + Math.sin(pitch) * z1,
    -Math.sin(pitch) * y + Math.cos(pitch) * z1,
  ];
};

// for each face, the part of its image in front of the camera (rect, in image px) and the window quad it lands on (tl,
// tr, br, bl). a side face runs back past the camera, so it's cut where its depth falls to near, which is far enough
// out that the cut lies past the window's edge. the cube's half size is 1 and the image's top row is the face's up.
// overlap (css px) stretches each quad that far past its edges, so neighbors overlap instead of leaving a seam where
// both edges are antialiased
export const deskQuads = ({
  width,
  height,
  size,
  faces,
  yaw = 0,
  pitch = DESK_REST_PITCH,
  overlap = 0,
}) => {
  const focal = height / (2 * TAN_HALF);
  const grow = (overlap * size) / (2 * focal);
  const near = Math.min(0.9, focal / width);
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  return Object.entries(faces).flatMap(([name, { dir, up }]) => {
    const right = cross(dir, up);
    const at = (ix, iy) => {
      const u = (2 * ix) / size - 1;
      const v = 1 - (2 * iy) / size;
      return toCamera(
        [0, 1, 2].map((k) => dir[k] + right[k] * u + up[k] * v),
        yawRad,
        pitchRad,
      );
    };
    const depth = (ix, iy) => -at(ix, iy)[2];
    const d00 = depth(0, 0);
    const gx = (depth(size, 0) - d00) / size;
    const gy = (depth(0, size) - d00) / size;
    let [x0, y0, x1, y1] = [0, 0, size, size];
    if (Math.abs(gx) >= Math.abs(gy)) {
      const worst = d00 + Math.min(0, gy * size);
      if (gx > 0) {
        x0 = Math.max(0, (near - worst) / gx);
      } else if (gx < 0) {
        x1 = Math.min(size, (near - worst) / gx);
      }
    } else {
      const worst = d00 + Math.min(0, gx * size);
      if (gy > 0) {
        y0 = Math.max(0, (near - worst) / gy);
      } else if (gy < 0) {
        y1 = Math.min(size, (near - worst) / gy);
      }
    }
    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    if (
      x1 - x0 < 1 ||
      y1 - y0 < 1 ||
      corners.some(([ix, iy]) => depth(ix, iy) < near * 0.999)
    ) {
      return [];
    }
    const quad = [
      [x0 - grow, y0 - grow],
      [x1 + grow, y0 - grow],
      [x1 + grow, y1 + grow],
      [x0 - grow, y1 + grow],
    ].map(([ix, iy]) => {
      const [x, y, z] = at(ix, iy);
      return [width / 2 + (focal * x) / -z, height / 2 - (focal * y) / -z];
    });
    return [{ name, rect: { x0, y0, x1, y1 }, quad }];
  });
};

const loadDeskManifest = async (name) => {
  if (!DESK_NAME.test(name ?? "")) {
    throw new Error(`no desk ${name}`);
  }
  const response = await fetch(`/flat/${name}/manifest.json`);
  if (!response.ok) {
    throw new Error(`the ${name} manifest didn't load (${response.status})`);
  }
  const manifest = await response.json();
  if (!Number.isFinite(manifest?.desk?.size) || !manifest.desk.faces) {
    throw new Error(`the ${name} manifest has no faces`);
  }
  return manifest;
};

// the desk for a set's manifest (which names its desk folder), in host behind the stage's layers
export const createDesk = ({ host, manifest }) => {
  const base = `/flat/${manifest.desk}/`;
  const el = document.createElement("div");
  el.className = "flat-desk";
  el.setAttribute("aria-hidden", "true");
  const layers = Object.fromEntries(
    LOOKS.map((look) => {
      const layer = document.createElement("div");
      layer.className = `flat-desk-look ${look}`;
      el.append(layer);
      return [look, layer];
    }),
  );
  host.prepend(el);

  let desk = null;
  let images = [];
  let faceEls = [];
  let decoding = null;
  let destroyed = false;

  // every face's element laid out again for the window's size
  const fit = () => {
    if (!desk) {
      return;
    }
    const placed = new Map(
      deskQuads({
        width: innerWidth,
        height: innerHeight,
        size: desk.size,
        faces: desk.faces,
        overlap: 1,
      }).map((q) => [q.name, q]),
    );
    faceEls.forEach(({ name, el: face }) => {
      const q = placed.get(name);
      if (!q) {
        face.style.display = "none";
        return;
      }
      const { x0, y0, x1, y1 } = q.rect;
      const w = x1 - x0;
      const h = y1 - y0;
      Object.assign(face.style, {
        display: "",
        width: `${w}px`,
        height: `${h}px`,
        backgroundPosition: `${-x0}px ${-y0}px`,
        transform: quadToQuad(
          [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
          ],
          q.quad,
        ),
      });
    });
  };

  // the faces' images decode before any joins the page, so the first frame never shows a desk still loading
  const decode = () => {
    if (destroyed) {
      return Promise.reject(new Error("the desk was destroyed"));
    }
    decoding ??= loadDeskManifest(manifest.desk)
      .then((loaded) => {
        const names = RESTING_FACES.filter((name) => loaded.desk.faces[name]);
        desk = {
          size: loaded.desk.size,
          faces: Object.fromEntries(
            names.map((name) => [name, loaded.desk.faces[name]]),
          ),
        };
        images = names.flatMap((name) =>
          LOOKS.map((look) => {
            const image = new Image();
            image.src = `${base}desk-${name}-${look}.webp`;
            return { name, look, image };
          }),
        );
        return Promise.all(images.map(({ image }) => image.decode()));
      })
      .catch((error) => {
        throw new Error(`the ${manifest.desk} desk didn't decode`, {
          cause: error,
        });
      })
      .then(() => {
        if (destroyed) {
          throw new Error("the desk was destroyed while decoding");
        }
        faceEls = images.map(({ name, look, image }) => {
          const face = document.createElement("i");
          face.className = "flat-desk-face";
          face.style.backgroundImage = `url("${image.src}")`;
          face.style.backgroundSize = `${desk.size}px ${desk.size}px`;
          layers[look].append(face);
          return { name, el: face };
        });
        fit();
      });
    return decoding;
  };

  // 0 shows the sharp desk, 1 the blurred one
  const setBlur = (t) => {
    layers.blur.style.opacity = String(Math.min(Math.max(t, 0), 1));
  };

  const destroy = () => {
    destroyed = true;
    el.remove();
    images.forEach(({ image }) => image.removeAttribute("src"));
    images = [];
    faceEls = [];
  };

  setBlur(0);

  return { setBlur, decode, fit, destroy, blurLayer: layers.blur };
};
