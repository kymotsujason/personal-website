// the desk behind the phone: the 3d desk's cube faces, captured through a 90 degree camera sharp and blurred
// (tools/capture-flat), set in a css 3d cube around the camera that the 75 degree desk view turns. the blurred cube
// lies over the sharp one and fades in as the phone opens, standing in for the 3d desk's blur. deskQuads is the same
// placement worked out by hand for one face, which the tests hold the cube to
import { DESK_FOV, DESK_REST_PITCH } from "../scene/shared/motion.js";

const TAN_HALF = Math.tan((DESK_FOV / 2) * (Math.PI / 180));
const DESK_NAME = /^desk-(day|dusk|night)-(full|half)$/;
// every face a clamped view can reach (the cube has no back, since the clamp keeps the view inside the photo)
const FACES = ["front", "left", "right", "up", "down"];
const LOOKS = ["sharp", "blur"];
const OVERLAP = 1;

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

// a face's matrix3d (column major) from its own px, centered on it, to the cube's px with the camera at the origin. the
// css cube is flipped in y (css points down), so each world direction is written as (x, -y, z)
export const faceMatrix = ({ dir, up }, focal) => {
  const right = cross(dir, up);
  const c0 = [right[0], -right[1], right[2]];
  const c1 = [-up[0], up[1], -up[2]];
  const c2 = cross(c0, c1);
  return [
    ...c0,
    0,
    ...c1,
    0,
    ...c2,
    0,
    focal * dir[0],
    -focal * dir[1],
    focal * dir[2],
    1,
  ];
};

// the cube's matrix3d: the world turned into the desk camera's view (toCamera), and the camera moved back to the
// perspective's distance
export const cubeMatrix = (yaw, pitch, focal) => {
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  const flip = [1, -1, 1];
  const columns = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((e, j) =>
    toCamera(e, yawRad, pitchRad).map((v, i) => v * flip[i] * flip[j]),
  );
  return [...columns[0], 0, ...columns[1], 0, ...columns[2], 0, 0, 0, focal, 1];
};

const matrix3d = (m) => `matrix3d(${m.join(", ")})`;

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
  // each look is a perspective box holding one cube, so the blur layer's opacity never flattens the cube's faces
  const layers = Object.fromEntries(
    LOOKS.map((look) => {
      const layer = document.createElement("div");
      layer.className = `flat-desk-look ${look}`;
      const cube = document.createElement("div");
      cube.className = "flat-desk-cube";
      layer.append(cube);
      el.append(layer);
      return [look, { layer, cube }];
    }),
  );
  host.prepend(el);

  let desk = null;
  let images = [];
  let faceEls = [];
  let decoding = null;
  let destroyed = false;
  let focal = 1;
  let view = { yaw: 0, pitch: DESK_REST_PITCH };
  let shownView = "";

  const turn = () => {
    const key = `${view.yaw} ${view.pitch} ${focal}`;
    if (key === shownView) {
      return;
    }
    shownView = key;
    const m = matrix3d(cubeMatrix(view.yaw, view.pitch, focal));
    LOOKS.forEach((look) => {
      layers[look].cube.style.transform = m;
    });
  };

  // every face laid out again for the window's size: 2 focal lengths across, and overlap px more each side so
  // neighbors cross instead of leaving a seam where both edges are antialiased
  const fit = () => {
    focal = innerHeight / (2 * TAN_HALF);
    const across = 2 * focal + 2 * OVERLAP;
    LOOKS.forEach((look) => {
      layers[look].layer.style.perspective = `${focal}px`;
    });
    faceEls.forEach(({ name, el: face }) => {
      Object.assign(face.style, {
        width: `${across}px`,
        height: `${across}px`,
        left: `${-across / 2}px`,
        top: `${-across / 2}px`,
        backgroundSize: `${across}px ${across}px`,
        transform: matrix3d(faceMatrix(desk.faces[name], focal)),
      });
    });
    shownView = "";
    turn();
  };

  // the faces' images decode before any joins the page, so the first frame never shows a desk still loading
  const decode = () => {
    if (destroyed) {
      return Promise.reject(new Error("the desk was destroyed"));
    }
    decoding ??= loadDeskManifest(manifest.desk)
      .then((loaded) => {
        const names = FACES.filter((name) => loaded.desk.faces[name]);
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
          layers[look].cube.append(face);
          return { name, el: face };
        });
        fit();
      });
    return decoding;
  };

  // 0 shows the sharp desk, 1 the blurred one. the blurred one covers the sharp one whole, so the sharp one is left out
  // once it's all the way in, which halves what the desk costs while the phone is open
  const setBlur = (t) => {
    const blur = Math.min(Math.max(t, 0), 1);
    layers.blur.layer.style.opacity = String(blur);
    layers.sharp.layer.style.visibility = blur >= 1 ? "hidden" : "";
  };

  // turns the view: yaw to the right and pitch (the lat of the view's center), in degrees
  const setView = (yaw, pitch) => {
    view = { yaw, pitch };
    turn();
  };

  const destroy = () => {
    destroyed = true;
    el.remove();
    images.forEach(({ image }) => image.removeAttribute("src"));
    images = [];
    faceEls = [];
  };

  setBlur(0);

  return {
    setBlur,
    setView,
    decode,
    fit,
    destroy,
    blurLayer: layers.blur.layer,
  };
};
