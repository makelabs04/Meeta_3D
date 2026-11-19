import * as THREE from 'three';

// These keys match the tabs; filenames are case-sensitive on most web hosts.
export const MODELS = {
  plate: { label: 'Guest Welcoming MEETA', file: 'MEETA_plate.glb' },
  tablet: { label: 'Guiding MEETA', file: 'MEETA_tablet.glb' },
  triangle: { label: 'MEETA', file: 'MEETA_Body-Triangle-part-updated.glb' }
};

export const PART_LABELS = {
  base: 'Base', torso: 'Torso', head: 'Head',
  leftArm: 'Left arm', rightArm: 'Right arm',
  leftHand: 'Left gripper', rightHand: 'Right gripper',
  plate: 'Front plate', tablet: 'Tablet holder'
};

const FINISHES = {
  orange: { color: 0xf46b17, metalness: 0.24, roughness: 0.34 },
  ember: { color: 0xc45216, metalness: 0.36, roughness: 0.37 },
  graphite: { color: 0x303237, metalness: 0.42, roughness: 0.36 },
  black: { color: 0x17191c, metalness: 0.32, roughness: 0.42 },
  lens: { color: 0xff8a27, metalness: 0.40, roughness: 0.17, emissive: 0xd84b04, emissiveIntensity: 0.25 },
  baseOrange: {
  color: 0xf46b17,
  metalness: 0.0,
  roughness: 0.95
},
};

// The source CAD meshes for these details contain only one side.
// Mirrored instances use the very same vertex data. Set false to show the exported halves.
export const MIRROR_CAD_HALVES = true;
const BODY_AXIS = 131.289;
const HEAD_AXIS = 128.47;
export const MODEL_HEIGHT = 2.4; // Normalized display height in scene units.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function indexNodes(gltf) {
  const map = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    const index = gltf.parser.associations.get(object)?.nodes;
    if (index !== undefined) map.set(gltf.parser.json.nodes[index].name, object);
  });
  return map;
}

function makeJoint(parent, name, x, y, z) {
  const joint = new THREE.Group();
  joint.name = name;
  parent.updateWorldMatrix(true, false);
  joint.position.copy(parent.worldToLocal(V3(x, y, z)));
  parent.add(joint);
  joint.updateWorldMatrix(true, false);
  return joint;
}

function forPrimitives(node, nodeIndex, visit) {
  if (node.isMesh) visit(node);
  // Multi-material glTF nodes have one child mesh per primitive.
  for (const child of node.children) {
    if (nodeIndex.has(child)) continue;
    forPrimitives(child, nodeIndex, visit);
  }
}

export function createRobot(gltf, variant) {
  const source = indexNodes(gltf);
  const namedNodes = new Set(source.values());
  for (const name of ['Base', 'triangle top 1', 'chest', 'face.001', 'elbow-meeta', 'servo gripper - left']) {
    if (!source.has(name)) throw new Error('This file does not match the supplied MEETA mesh layout.');
  }
  const root = new THREE.Group();
  // The two cone shells overlap and have different normals in the exported GLB.
  // Use an unlit finish for those two meshes so the overlap doesn't create
  // a noticeably darker orange band. Other parts keep their original PBR finish.
  const palette = Object.fromEntries(Object.entries(FINISHES).map(([key, values]) => [
    key,
    key === 'baseOrange'
      ? new THREE.MeshBasicMaterial({ name: key, color: values.color, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ name: key, side: THREE.DoubleSide, ...values })
  ]));
  const meshes = [];
  const outlines = [];
  const boundsByPart = new Map();
  const joints = {};
  const base = joints.base = makeJoint(root, 'Base swivel', BODY_AXIS, 87.88, -130.29);
  const torso = joints.torso = makeJoint(base, 'Waist', BODY_AXIS, 806, -130);
  const head = joints.head = makeJoint(torso, 'Neck swivel', HEAD_AXIS, 1237, -141);

  // Source object origins are often far from their geometry. Preserve their full
  // exported world matrices and put mechanical pivots at the actual joint axes.
  function attachPart(joint, key, finish, name, mirrorAxis) {
    const node = source.get(name);
    if (!node) throw new Error('Missing MEETA component: ' + name);
    const inverse = joint.matrixWorld.clone().invert();
    const reflection = mirrorAxis === undefined || !MIRROR_CAD_HALVES ? null :
      new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(2 * mirrorAxis, 0, 0);

    forPrimitives(node, namedNodes, primitive => {
      const worlds = [primitive.matrixWorld];
      if (reflection) worlds.push(reflection.clone().multiply(primitive.matrixWorld));
      for (const world of worlds) {
        const material = typeof finish === 'function' ? finish(primitive) : finish;
        const mesh = new THREE.Mesh(primitive.geometry, palette[material]);
        mesh.name = name;
        mesh.userData.part = key;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(inverse, world);
        joint.add(mesh);
        mesh.updateWorldMatrix(true, false);
        meshes.push(mesh);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox.clone().applyMatrix4(world);
        if (!boundsByPart.has(key)) boundsByPart.set(key, new THREE.Box3());
        boundsByPart.get(key).union(box);
      }
    });
  }

  // Keep the assembled parts for this variant. The source files also contain
  // overlapping prototypes, Boolean cutters, and parked accessory alternatives.
  attachPart(base, 'base', 'black', 'Base');
  // These are the cut planes of the three individual CAD shells, in source units.
  attachPart(base, 'base', 'baseOrange', 'triangle top 2', 131.463);
  attachPart(base, 'base', 'baseOrange', 'triangle top 1', 131.210);
  attachPart(base, 'base', 'baseOrange', 'Base back plate', 131.702);
  attachPart(base, 'base', 'graphite', 'circle.001');

  attachPart(torso, 'torso', 'orange', 'chest');
  attachPart(torso, 'torso', 'orange', 'chest-back Plate');
  attachPart(torso, 'torso', 'black', 'inside-plate');
  attachPart(torso, 'torso', 'black', 'shoulder');
  attachPart(torso, 'torso', 'black', 'Text');
  attachPart(torso, 'head', 'graphite', 'neck', 128.099);
  attachPart(head, 'head', 'orange', 'face.001');
  attachPart(head, 'head', 'orange', 'head back hole.001');
  attachPart(head, 'head', 'graphite', 'ear', HEAD_AXIS);
  attachPart(head, 'head', 'lens', 'eyes', HEAD_AXIS);
  attachPart(head, 'head', 'black', 'head hole');

  const isPlate = variant === 'plate';
  // A rigid plate joins the two forearms. Shared pitch pivots keep both mounts aligned.
  const carry = isPlate ? (joints.carry = makeJoint(torso, 'Linked shoulders', BODY_AXIS, 1094, -151)) : null;
  const lift = isPlate ? (joints.lift = makeJoint(carry, 'Plate lift', BODY_AXIS, 826, -151)) : null;

  for (const side of ['left', 'right']) {
    const left = side === 'left';
    const x = left ? 343 : -79;
    const z = left ? -158 : -146;
    const armKey = side + 'Arm';
    const handKey = side + 'Hand';
    const suffix = left ? '-left' : '';
    const upper = carry || (joints[armKey] = makeJoint(torso, side + ' shoulder', x, 1094, -151));
    const lower = lift || (joints[side + 'Elbow'] = makeJoint(upper, side + ' elbow', x, 824, z));
    const handName = 'servo gripper - ' + side;
    const center = new THREE.Box3().setFromObject(source.get(handName), true).getCenter(new THREE.Vector3());
    const toElbow = V3(x, 824, z).sub(center).normalize();
    const wristPosition = center.addScaledVector(toElbow, 65);
    const wrist = joints[handKey] = makeJoint(lower, side + ' wrist', wristPosition.x, wristPosition.y, wristPosition.z);

    attachPart(upper, armKey, 'graphite', 'Shoulder-meeta' + suffix);
    attachPart(upper, armKey, 'ember', 'elbow-meeta' + suffix + '.001');
    attachPart(lower, armKey, 'orange', 'elbow-meeta' + suffix);
    attachPart(wrist, handKey, 'graphite', handName);
  }

  if (isPlate) {
    // The original crosspiece has separate connector and plate primitives.
    attachPart(lift, 'plate', mesh => mesh.material.name?.startsWith('Material.010') ? 'ember' : 'graphite', 'elbow-meeta.connector');
    attachPart(lift, 'plate', 'black', 'elbow-meeta.connector.001');
    attachPart(lift, 'plate', 'black', 'elbow-meeta.connector.002');
  }
  if (variant === 'tablet') {
    const mount = joints.tablet = makeJoint(base, 'Tablet hinge', BODY_AXIS, 760, -23);
    attachPart(base, 'tablet', 'black', '04_Circle_Fixed_Receiver');
    attachPart(mount, 'tablet', 'ember', '03_Tray_Slide_Adapter');
    attachPart(mount, 'tablet', 'graphite', 'DOMO_SL39_Holder');
    // Trace the actual holder edges so the dark frame reads against the dark torso.
    for (const holder of meshes.filter(mesh => mesh.name === 'DOMO_SL39_Holder')) {
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(holder.geometry, 49),
        new THREE.LineBasicMaterial({ color: 0xd87838, transparent: true, opacity: 0.57, depthWrite: false }));
      holder.add(outline);
      outlines.push(outline);
    }
  }

  const bounds = new THREE.Box3().setFromObject(root, true);
  const displayScale = MODEL_HEIGHT / (bounds.max.y - bounds.min.y);
  root.scale.setScalar(displayScale);
  root.position.set(-BODY_AXIS * displayScale, -bounds.min.y * displayScale, 130.29 * displayScale);
  root.updateMatrixWorld(true);
  const anchors = Object.fromEntries([...boundsByPart].map(([key, box]) =>
    [key, box.getCenter(new THREE.Vector3())]
  ));

  // A small motion controller lives on top of the existing mechanical joints.
  // It never writes to the GLB; the original model, colors and geometry remain intact.
  let pointer = null;
  let gesture = null;
  let gestureTime = 0;
  let idleTime = 0;
  let autoMotion = true;
  let paused = false;
  let tabletOrientation = 'portrait';
  let lastUserActivity = 0;
  let elapsed = 0;
  const freeArms = variant !== 'plate';
  // Only motions supported by the exported arm mechanism are offered.
  // In particular, there is no lateral shoulder-raise gesture.
  const gestureLengths = {
    wave: 3.5, handshake: 3.2, welcome: 3.1,
    nod: 2.3, left: 2.8, right: 2.8, center: 1.1
  };

  // Pointer coordinates are normalized to [-1, 1] across the stage.
  // A separately selected arm receives more local pointer motion.
  function setPointer(active, gx = 0, gy = 0, part = null, lx = 0, ly = 0) {
    pointer = active ? { gx, gy, part, lx, ly } : null;
    if (active) lastUserActivity = elapsed;
  }

  function pointAt(part, x = 0, y = 0) {
    if (part === null) setPointer(false);
    else setPointer(true, x, y, part, x, y);
  }

  function startGesture(name) {
    if (!gestureLengths[name]) return false;
    if (!freeArms && ['wave', 'handshake', 'welcome', 'raise'].includes(name)) return false;
    gesture = name;
    gestureTime = 0;
    lastUserActivity = elapsed;
    return true;
  }

  function setTabletOrientation(next) {
    if (variant !== 'tablet' || !['portrait', 'landscape'].includes(next)) return;
    tabletOrientation = next;
    lastUserActivity = elapsed;
  }

  function setAutoMotion(on) { autoMotion = Boolean(on); lastUserActivity = elapsed; }
  function setPaused(on) { paused = Boolean(on); }
  function needsContinuousAnimation() { return !paused && (autoMotion || Boolean(gesture)); }

  function animate(delta, reducedMotion) {
    if (paused) return false;
    elapsed += delta;
    const rotations = new Map();
    const rotate = (name, rx = 0, ry = 0, rz = 0) => rotations.set(name, [rx, ry, rz]);
    const put = (name, ix, value) => {
      const angles = rotations.get(name) || [0, 0, 0];
      angles[ix] = value;
      rotations.set(name, angles);
    };
    const natural = reducedMotion ? 0.35 : 1;
    const userControl = Boolean(pointer);

    // Head follows the visitor's mouse ANYWHERE over the stage, even if the
    // ray misses the model. This is intentionally independent of hand picking.
    if (userControl) {
      rotate('head', THREE.MathUtils.clamp(-0.13 * pointer.gy, -0.22, 0.22),
        THREE.MathUtils.clamp(0.92 * pointer.gx, -0.98, 0.98), -0.05 * pointer.gx);
      if (pointer.part === 'torso') rotate('torso', -0.03 * pointer.ly, 0.09 * pointer.lx);
      if (pointer.part === 'base') rotate('base', 0, 0.10 * pointer.lx);
      // The tray/plate configuration has physically linked forearms:
      // never move carry/lift pivots, otherwise the plate intersects the hands.
      if (freeArms && ['leftArm','rightArm','leftHand','rightHand'].includes(pointer.part)) {
        const side = pointer.part.startsWith('left') ? 'left' : 'right';
        const sign = side === 'left' ? 1 : -1;
        const px = pointer.lx, py = pointer.ly;
        // MEETA Tablet shoulders are single-axis pitch joints: FORWARD/BACK ONLY.
        // The small wrist adjustment is not a sideways shoulder rotation.
        if (variant === 'tablet') {
          rotate(side + 'Arm', -0.12 - 0.67 * Math.max(0, py), 0, 0);
          rotate(side + 'Elbow', -0.18 - 0.52 * Math.max(0, py), 0, 0);
          rotate(side + 'Hand', -0.08 * py, 0.12 * px, 0);
        } else {
          rotate(side + 'Arm', -0.16 - 0.48 * Math.max(0, py),
            sign * 0.08 * px, sign * (0.11 + 0.20 * Math.max(0, py)));
          rotate(side + 'Elbow', -0.25 - 0.46 * Math.max(0, py));
          rotate(side + 'Hand', -0.10 * py, 0.22 * px, sign * 0.12 * px);
        }
      }
    } else if (autoMotion && elapsed - lastUserActivity > 1.5) {
      idleTime += delta;
      rotate('head', 0.045 * Math.sin(idleTime * 0.65), 0.18 * Math.sin(idleTime * 0.37));
      rotate('torso', 0, 0.027 * Math.sin(idleTime * 0.30));
    }

    // Automatic demonstration is subtle. The plate model only moves its head;
    // the other two configurations occasionally greet the visitor.
    // Tablet model remains in its neutral, straight-arm pose unless a gesture
    // is explicitly selected or the visitor interacts near a hand.
    // Automatic waving is limited to the triangle configuration.
    if (autoMotion && variant === 'triangle' && !userControl && !gesture &&
        elapsed - lastUserActivity > 5.5 && idleTime > 14) {
      gesture = 'wave';
      gestureTime = 0;
      idleTime = 0;
    }

    if (gesture) {
      gestureTime += delta;
      const duration = gestureLengths[gesture];
      const a = Math.max(0, Math.min(1, gestureTime / .55, (duration - gestureTime) / .55));
      const s = a * a * (3 - 2 * a); // ease into and out of each pose
      const w = Math.sin(gestureTime * Math.PI * 4.4);
      switch (gesture) {
        case 'wave':
          // Pitch the upper arm FORWARD, then bend the forearm upward by its
          // elbow pitch. No sideways/T-pose shoulder roll. Wiggle at the wrist.
          rotate('rightArm', -1.04 * s, 0, 0);
          rotate('rightElbow', -1.22 * s, 0, 0);
          rotate('rightHand', (0.09 + 0.08 * w) * s, 0, 0.20 * w * s);
          rotate('head', -0.06 * s, -0.18 * s);
          break;
        case 'handshake':
          if (variant === 'tablet') {
            // Tablet: forward-only shoulder pitch; keep its original hinge plane.
            rotate('rightArm', -0.83 * s, 0, 0);
            rotate('rightElbow', -0.42 * s, 0, 0);
            rotate('rightHand', (0.10 + 0.13 * w) * s, 0, 0);
          } else {
            // Preserve the Triangle model's previously approved handshake.
            rotate('rightArm', -0.78 * s, 0, -0.20 * s);
            rotate('rightElbow', -0.52 * s);
            rotate('rightHand', (0.12 + 0.14 * w) * s, 0, -0.06 * s);
          }
          rotate('head', 0.10 * s, -0.16 * s);
          break;
        case 'welcome':
          if (variant === 'tablet') {
            // Both shoulders stay inside the forward/backward pitch plane.
            rotate('leftArm', -0.58 * s, 0, 0);
            rotate('rightArm', -0.58 * s, 0, 0);
            rotate('leftElbow', -0.35 * s);
            rotate('rightElbow', -0.35 * s);
          } else {
            rotate('leftArm', -0.16 * s, 0, 0.92 * s);
            rotate('rightArm', -0.16 * s, 0, -0.92 * s);
            rotate('leftElbow', -0.12 * s);
            rotate('rightElbow', -0.12 * s);
          }
          rotate('head', -0.10 * s);
          break;
        case 'nod':
          rotate('head', (0.08 + 0.29 * Math.sin(gestureTime * 6.7)) * s, 0, 0);
          break;
        case 'left': rotate('head', 0, 1.18 * s); break;
        case 'right': rotate('head', 0, -1.18 * s); break;
        case 'center': rotate('head', 0, 0, 0); break;
      }
      if (gestureTime >= duration) { gesture = null; gestureTime = 0; }
    }

    // Portrait/landscape are retained until the user changes the setting.
    if (variant === 'tablet') {
      const tilt = pointer?.part === 'tablet' ? -0.12 * pointer.ly : 0;
      rotate('tablet', tilt, 0, tabletOrientation === 'landscape' ? Math.PI / 2 : 0);
    }

    const blend = reducedMotion ? 1 : 1 - Math.exp(-9 * delta);
    let moving = false;
    for (const [name, joint] of Object.entries(joints)) {
      let targetAngles = rotations.get(name) || [0, 0, 0];
      if (variant === 'tablet' && (name === 'leftArm' || name === 'rightArm')) {
        targetAngles = [THREE.MathUtils.clamp(targetAngles[0], -1.18, 0.25), 0, 0];
      }
      for (const [index, axis] of ['x', 'y', 'z'].entries()) {
        const target = targetAngles[index] * natural;
        const difference = target - joint.rotation[axis];
        if (Math.abs(difference) < 0.0005) joint.rotation[axis] = target;
        else { joint.rotation[axis] += difference * blend; moving = true; }
      }
    }
    return moving;
  }

  return {
    root, meshes, anchors, pointAt, animate, setPointer, startGesture,
    setTabletOrientation, setAutoMotion, setPaused, needsContinuousAnimation,
    reset() {
      pointer = null;
      gesture = null;
      gestureTime = 0;
      idleTime = 0;
      lastUserActivity = elapsed;
      for (const joint of Object.values(joints)) joint.rotation.set(0, 0, 0);
    },
    dispose() {
      for (const geometry of new Set(meshes.map(mesh => mesh.geometry))) geometry.dispose();
      for (const material of Object.values(palette)) material.dispose();
      for (const line of outlines) { line.geometry.dispose(); line.material.dispose(); }
      root.removeFromParent();
    }
  };
}
