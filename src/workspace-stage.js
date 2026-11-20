import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ROBOT_NAMES = {
  inspection: 'MEETA 01 · Inspection',
  rework: 'MEETA 02 · Rework',
  packing: 'MEETA 03 · Packing'
};

const FIT_DIRECTION = new THREE.Vector3(1.12, 0.95, 1.2).normalize();
const clamp = THREE.MathUtils.clamp;

export class WorkspaceStage {
  constructor(canvas, onMessage = () => {}) {
    this.canvas = canvas;
    this.onMessage = onMessage;
    this.model = null;
    this.mixer = null;
    this.actions = [];
    this.playback = 'stopped';
    this.transition = null;
    this.activeArea = 'overview';
    this.needsRender = true;
    this.previousTime = 0;
    this.animationHandle = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.022, 500);
    this.camera.position.set(20, 16, 23);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.95;
    this.controls.rotateSpeed = 0.77;
    this.controls.zoomSpeed = 1.05;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.65;
    this.controls.maxDistance = 160;
    this.controls.minPolarAngle = 0.025;
    this.controls.maxPolarAngle = Math.PI - 0.025;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.target.set(0, 1.3, 0);
    this.controls.update();
    this.controls.addEventListener('start', () => { this.transition = null; });
    this.controls.addEventListener('change', () => { this.needsRender = true; });

    this.scene.add(new THREE.HemisphereLight(0xf4fbff, 0x818990, 1.65));
    const key = new THREE.DirectionalLight(0xfff9ef, 2.5);
    key.position.set(-7, 17, 11);
    const fill = new THREE.DirectionalLight(0xbdeaff, 1.4);
    fill.position.set(7, 10, -7);
    const rim = new THREE.DirectionalLight(0xffffff, 0.75);
    rim.position.set(0, 8, -12);
    this.scene.add(key, fill, rim);

    // Environment reflections for the existing glTF materials, without adding any
    // extra geometry to the user's factory file.
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    room.dispose();
    pmrem.dispose();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.animationHandle = requestAnimationFrame(t => this.frame(t));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.needsRender = true;
  }

  async load(onProgress = () => {}) {
    const url = new URL('./models/MEETA_Smart_Factory.glb', document.baseURI).href;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url, event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      } else if (event.loaded) {
        onProgress(null, event.loaded);
      }
    });
    this.setModel(gltf);
    return gltf;
  }

  setModel(gltf) {
    if (this.model) this.scene.remove(this.model);
    this.model = gltf.scene;
    // The master parts are Blender reference/prototype meshes. The factory has
    // separate, animated copies for all three MEETA robots.
    this.model.traverse(object => {
      if (object.name.startsWith('Master /')) object.visible = false;
      if (object.name === 'Studio | shadow floor') object.visible = false;
      if (object.isMesh && object.material) {
        object.frustumCulled = true;
      }
    });
    this.scene.add(this.model);
    this.model.updateMatrixWorld(true);
    const slab = this.model.getObjectByName('Factory floor | 16 × 10 m epoxy slab');
    if (slab) {
      this.factoryBounds = new THREE.Box3().setFromObject(slab);
      // Floor alone is very flat; include the 3-metre-tall factory above it.
      this.factoryBounds.min.y = Math.min(this.factoryBounds.min.y, -0.1);
      this.factoryBounds.max.y = Math.max(this.factoryBounds.max.y, 3.3);
    } else {
      // Fallback for alternative exports: avoid the oversized 190-m studio floor.
      const sceneBounds = new THREE.Box3();
      this.model.traverse(o => {
        if (o.isMesh && o.visible) sceneBounds.expandByObject(o, true);
      });
      this.factoryBounds = sceneBounds;
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = gltf.animations.map(clip => {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      return action;
    });
    this.playback = this.actions.length ? 'playing' : 'stopped';
    this.focus('overview', false);
    this.onMessage(this.actions.length ? `${this.actions.length} animation tracks playing · Overview` : 'Factory loaded · No embedded animations');
    this.needsRender = true;
  }

  getOverviewCamera() {
    const bounds = this.factoryBounds;
    const center = bounds.getCenter(new THREE.Vector3());
    center.y = 1.25;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const vAngle = THREE.MathUtils.degToRad(this.camera.fov);
    const hAngle = 2 * Math.atan(Math.tan(vAngle / 2) * Math.max(0.1, this.camera.aspect));
    const distance = Math.max(18, (sphere.radius / Math.sin(Math.min(vAngle, hAngle) / 2)) * 1.18);
    return { target: center, position: center.clone().addScaledVector(FIT_DIRECTION, distance) };
  }

  getRobotCamera(area) {
    const robot = this.model?.getObjectByName(ROBOT_NAMES[area]);
    if (!robot) return null;
    robot.updateWorldMatrix(true, true);
    const anchor = robot.getWorldPosition(new THREE.Vector3());
    const target = anchor.clone().add(new THREE.Vector3(0, 0.92, 0));
    // Orient toward the front of the actual animated robot assembly.
    const q = robot.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    forward.y = 0;
    forward.normalize();
    if (forward.lengthSq() < 0.1) forward.set(0, 0, 1);
    const lateral = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const position = target.clone().addScaledVector(forward, 4.65).addScaledVector(lateral, 1.15);
    position.y += 2.25;
    return { target, position };
  }

  focus(area, animate = true) {
    if (!this.model) return false;
    const view = area === 'overview' ? this.getOverviewCamera() : this.getRobotCamera(area);
    if (!view) return false;
    this.activeArea = area;
    this.moveCamera(view.position, view.target, animate);
    this.onMessage(area === 'overview' ? 'Overview · Complete factory' : `${area[0].toUpperCase() + area.slice(1)} robot · Drag to explore`);
    return true;
  }

  moveCamera(position, target, animate = true) {
    if (!animate) {
      this.transition = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    } else {
      this.transition = {
        start: performance.now(), duration: 850,
        cameraFrom: this.camera.position.clone(), cameraTo: position.clone(),
        targetFrom: this.controls.target.clone(), targetTo: target.clone()
      };
    }
    this.needsRender = true;
  }

  view(angle) {
    if (!this.model) return;
    const target = this.controls.target.clone();
    const distance = clamp(this.camera.position.distanceTo(target), 2, this.controls.maxDistance);
    const direction = angle === 'top'
      ? new THREE.Vector3(0, 1, 0.055)
      : angle === 'bottom'
        ? new THREE.Vector3(0, -1, 0.055)
        : new THREE.Vector3(0, 0.16, 1);
    direction.normalize();
    this.moveCamera(target.clone().addScaledVector(direction, distance), target, true);
  }

  zoom(factor) {
    if (!this.model) return;
    this.transition = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), distance);
    this.controls.update();
    this.needsRender = true;
  }

  fit() { return this.focus('overview', true); }

  play() {
    if (!this.actions.length) return false;
    if (this.playback === 'stopped') {
      for (const action of this.actions) action.reset().play();
      this.mixer.setTime(0);
    }
    for (const action of this.actions) action.paused = false;
    this.playback = 'playing';
    this.needsRender = true;
    return true;
  }

  pause() {
    if (!this.actions.length) return false;
    for (const action of this.actions) action.paused = true;
    this.playback = 'paused';
    this.needsRender = true;
    return true;
  }

  stop() {
    if (!this.actions.length) return false;
    // Pose every tracked component at the first keyframe, then hold there.
    for (const action of this.actions) { action.reset(); action.play(); action.paused = false; }
    this.mixer.setTime(0);
    for (const action of this.actions) action.paused = true;
    this.playback = 'stopped';
    this.needsRender = true;
    return true;
  }

  frame(time) {
    this.animationHandle = requestAnimationFrame(t => this.frame(t));
    const dt = this.previousTime ? Math.min((time - this.previousTime) / 1000, 0.06) : 0;
    this.previousTime = time;
    if (this.playback === 'playing' && this.mixer) {
      this.mixer.update(dt);
      this.needsRender = true;
    }
    if (this.transition) {
      const a = clamp((time - this.transition.start) / this.transition.duration, 0, 1);
      const ease = a * a * (3 - 2 * a);
      this.camera.position.lerpVectors(this.transition.cameraFrom, this.transition.cameraTo, ease);
      this.controls.target.lerpVectors(this.transition.targetFrom, this.transition.targetTo, ease);
      this.needsRender = true;
      if (a >= 1) this.transition = null;
    }
    const changed = this.controls.update();
    if (this.needsRender || changed) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  dispose() {
    cancelAnimationFrame(this.animationHandle);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.mixer) this.mixer.stopAllAction();
    this.environment.dispose();
    this.renderer.dispose();
  }
}
