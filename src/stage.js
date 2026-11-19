import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODEL_HEIGHT } from './robot.js';

const clamp = THREE.MathUtils.clamp;
const homeDirection = new THREE.Vector3(0.49, 0.17, 1).normalize();

function makeFloor() {
  // A small photographic contact shadow and a fading inspection grid.
  const image = document.createElement('canvas');
  image.width = image.height = 1024;
  const ctx = image.getContext('2d');
  const center = image.width / 2;
  ctx.translate(center, center);
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = 'rgba(166,162,157,.28)';
  ctx.beginPath();
  for (let p = -center; p <= center; p += 32) {
    ctx.moveTo(p, -center); ctx.lineTo(p, center);
    ctx.moveTo(-center, p); ctx.lineTo(center, p);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(198,187,176,.66)';
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(0, 0, 170, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#c76535';
  ctx.lineWidth = 3.2;
  for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    ctx.beginPath(); ctx.arc(0, 0, 170, angle - .07, angle + .07); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(0, 0, 140, 0, 0, 495);
  fade.addColorStop(0, '#000'); fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(-center, -center, 1024, 1024);
  ctx.globalCompositeOperation = 'source-over';
  const shadow = ctx.createRadialGradient(0, 0, 30, 0, 0, 125);
  shadow.addColorStop(0, 'rgba(0,0,0,.98)');
  shadow.addColorStop(.49, 'rgba(0,0,0,.73)');
  shadow.addColorStop(1, 'transparent');
  ctx.fillStyle = shadow;
  ctx.fillRect(-125, -125, 250, 250);
  const map = new THREE.CanvasTexture(image);
  map.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 5.8),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.renderOrder = -1;
  return floor;
}

export class Stage {
  constructor(canvas, onPart) {
    this.canvas = canvas;
    this.onPart = onPart;
    this.robot = null;
    this.activePart = null;
    this.frame = null;
    this.lastFrame = 0;
    this.fitDistance = 0;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.anchor = new THREE.Vector3();
    this.pendingPoint = null;
    this.pointerStarts = new Map();
    this.autoMotion = true;
    this.motionPaused = false;
    this.motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;

    this.scene = new THREE.Scene();
    // Small near clipping plane allows close inspection of the head and base.
    this.camera = new THREE.PerspectiveCamera(31, 1, 0.012, 80);
    this.camera.position.copy(homeDirection).multiplyScalar(5);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.67;
    room.dispose();
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffeee0, 2.3);
    key.position.set(-3.5, 5.4, 4.5);
    const rim = new THREE.DirectionalLight(0xffb779, 2.1);
    rim.position.set(3, 3.6, -2.8);
    const fill = new THREE.DirectionalLight(0xd9e7ff, 1.1);
    fill.position.set(2.5, 2.3, 3.4);
    this.scene.add(key, rim, fill, new THREE.HemisphereLight(0xf1f2ff, 0x61554b, 0.7), makeFloor());

    this.controls = new OrbitControls(this.camera, canvas);
    // Full orbital inspection: top, underside, and right-drag/two-finger pan.
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.85;
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.68;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = 0.025;
    this.controls.maxPolarAngle = Math.PI - 0.025;
    this.controls.addEventListener('change', () => this.requestFrame());
    this.controls.addEventListener('start', () => this.clearFocus());
    this.bindInput();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.resize();
    this.resetView();
  }

  bindInput() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', event => {
      const press = { x: event.clientX, y: event.clientY, moved: false };
      this.pointerStarts.set(event.pointerId, press);
      if (this.pointerStarts.size > 1) {
        for (const active of this.pointerStarts.values()) active.moved = true;
      }
      this.clearFocus();
    });
    canvas.addEventListener('pointermove', event => {
      const press = this.pointerStarts.get(event.pointerId);
      if (press) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
        return;
      }
      if (event.pointerType !== 'touch' && !event.buttons) this.queuePick(event);
    });
    canvas.addEventListener('pointerup', event => {
      const press = this.pointerStarts.get(event.pointerId);
      this.pointerStarts.delete(event.pointerId);
      if (press && !press.moved && this.pointerStarts.size === 0) this.queuePick(event);
    });
    canvas.addEventListener('pointercancel', event => {
      this.pointerStarts.delete(event.pointerId);
      this.clearFocus();
    });
    canvas.addEventListener('lostpointercapture', event => {
      this.pointerStarts.delete(event.pointerId);
    });
    canvas.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch') this.clearFocus();
    });
    canvas.addEventListener('keydown', event => {
      const step = Math.PI / 14;
      switch (event.key.toLowerCase()) {
        case 'arrowleft': this.orbit(-step, 0); break;
        case 'arrowright': this.orbit(step, 0); break;
        case 'arrowup': this.orbit(0, -step); break;
        case 'arrowdown': this.orbit(0, step); break;
        case '+': case '=': this.zoom(0.82); break;
        case '-': case '_': this.zoom(1 / 0.82); break;
        case 'r': this.resetView(); break;
        case 't': this.viewFrom('top'); break;
        case 'b': this.viewFrom('bottom'); break;
        default: return;
      }
      event.preventDefault();
    });
  }

  setRobot(robot) {
    this.clearFocus();
    this.robot?.dispose();
    this.robot = robot;
    if (robot) {
      this.scene.add(robot.root);
      robot.setAutoMotion(this.autoMotion);
      robot.setPaused(this.motionPaused);
    }
    this.controls.enabled = Boolean(robot);
    this.resetView();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const previousDistance = this.fitDistance;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * .5));
    this.fitDistance = Math.max(MODEL_HEIGHT * .58 / halfFov, .70 / (halfFov * this.camera.aspect)) + .09;
    this.controls.minDistance = Math.max(0.28, this.fitDistance * .12);
    this.controls.maxDistance = this.fitDistance * 3;
    if (previousDistance > 0) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(this.fitDistance / previousDistance));
    }
    this.controls.update();
    this.requestFrame();
  }

  resetView() {
    this.clearFocus();
    this.robot?.reset();
    // Flush residual orbit damping before writing an exact home pose.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, MODEL_HEIGHT * .495, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(homeDirection, this.fitDistance);
    this.controls.update();
    this.controls.enableDamping = true;
    this.requestFrame();
  }

  zoom(factor) {
    if (!this.robot) return;
    this.clearFocus();
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.requestFrame();
  }

  orbit(horizontal, vertical) {
    if (!this.robot) return;
    this.clearFocus();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += horizontal;
    spherical.phi = clamp(spherical.phi + vertical, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.controls.update();
    this.requestFrame();
  }

  viewFrom(direction) {
    if (!this.robot || !['top', 'bottom'].includes(direction)) return;
    this.clearFocus();
    // Preserve the current inspection center and zoom level.
    const distance = clamp(this.camera.position.distanceTo(this.controls.target),
      this.controls.minDistance, this.controls.maxDistance);
    this.controls.enableDamping = false;
    this.controls.update();
    const dir = direction === 'top'
      ? new THREE.Vector3(0, 1, 0.025)
      : new THREE.Vector3(0, -1, 0.025);
    this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), distance);
    this.controls.update();
    this.controls.enableDamping = true;
    this.requestFrame();
  }

  gesture(name) {
    if (!this.robot || !this.robot.startGesture(name)) return false;
    this.requestFrame();
    return true;
  }

  tabletOrientation(orientation) {
    this.robot?.setTabletOrientation(orientation);
    this.requestFrame();
  }

  setAutoMotion(on) {
    this.autoMotion = Boolean(on);
    this.robot?.setAutoMotion(this.autoMotion);
    this.requestFrame();
  }

  setMotionPaused(on) {
    this.motionPaused = Boolean(on);
    this.robot?.setPaused(this.motionPaused);
    this.requestFrame();
  }

  resetPose() {
    this.clearFocus();
    this.robot?.reset();
    this.requestFrame();
  }

  queuePick(event) {
    this.pendingPoint = [event.clientX, event.clientY];
    this.requestFrame();
  }

  clearFocus() {
    this.pendingPoint = null;
    this.robot?.setPointer(false);
    if (this.activePart !== null) {
      this.activePart = null;
      this.onPart(null);
    }
    this.canvas.dataset.hit = 'false';
    this.requestFrame();
  }

  pick(clientX, clientY) {
    if (!this.robot) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.ndc.set(2 * (clientX - rect.left) / rect.width - 1,
      1 - 2 * (clientY - rect.top) / rect.height);
    this.camera.updateMatrixWorld();
    this.robot.root.updateMatrixWorld(true);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.robot.meshes, false)[0];
    let part = hit?.object.userData.part || null;

    // Screen-space proximity makes hands interactive even when the pointer is
    // NEXT TO the gripper, rather than directly over its tiny polygons.
    let closestHand = null;
    let nearest = 105; // CSS pixels
    for (const side of ['left', 'right']) {
      const mesh = this.robot.meshes.find(m => m.userData.part === side + 'Hand');
      if (!mesh) continue;
      const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld).project(this.camera);
      if (center.z < -1 || center.z > 1) continue;
      const x = rect.left + (center.x + 1) * rect.width / 2;
      const y = rect.top + (1 - center.y) * rect.height / 2;
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < nearest) { nearest = d; closestHand = side + 'Hand'; }
    }
    if (closestHand && (!part || part === 'torso' || part === 'base' || part.endsWith('Hand'))) {
      part = closestHand;
    }

    let localX = this.ndc.x, localY = this.ndc.y;
    if (part && this.robot.anchors[part]) {
      this.anchor.copy(this.robot.anchors[part]).applyMatrix4(this.robot.root.matrixWorld).project(this.camera);
      const distance = this.camera.position.distanceTo(this.controls.target);
      const ppu = rect.height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
      const span = Math.max(35, ppu * (part === 'base' ? .40 : part === 'torso' ? .24 : .20));
      localX = clamp((this.ndc.x - this.anchor.x) * rect.width * .5 / span, -1, 1);
      localY = clamp((this.ndc.y - this.anchor.y) * rect.height * .5 / span, -1, 1);
    }
    if (this.motionPaused) return;
    this.robot.setPointer(true, this.ndc.x, this.ndc.y, part, localX, localY);
    if (this.activePart !== part) {
      this.activePart = part;
      this.onPart(part);
    }
    this.canvas.dataset.hit = String(Boolean(part));
  }

  requestFrame() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(time => {
      this.frame = null;
      const delta = clamp((time - this.lastFrame) / 1000, 0.001, 0.05);
      this.lastFrame = time;
      const orbiting = this.controls.update(delta);
      if (this.pendingPoint) {
        const point = this.pendingPoint;
        this.pendingPoint = null;
        this.pick(...point);
      }
      const posing = this.robot?.animate(delta, this.motionPreference.matches);
      this.renderer.render(this.scene, this.camera);
      if (posing || orbiting || this.robot?.needsContinuousAnimation()) this.requestFrame();
    });
  }
}
