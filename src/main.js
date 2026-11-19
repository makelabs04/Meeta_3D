import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRobot, MODELS, PART_LABELS } from './robot.js';
import { Stage } from './stage.js';

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panel = $('viewer-panel');
const canvas = $('viewport');
const status = $('status-box');
const tools = [$('zoom-out'), $('zoom-in'), $('view-front'), $('view-top'), $('view-bottom'), $('reset')];
const loader = new GLTFLoader();
let stage;
let active = '';
let request;
let autoMotionEnabled = true;
let motionPaused = false;
let tabletOrientation = 'portrait';
const motionPanel = $('motion-panel');
const motionToggle = $('motion-toggle');
const motionButtons = [...document.querySelectorAll('[data-gesture]')];
const descriptions = {
  plate: 'A friendly first impression. Discover MEETA in its guest-welcoming configuration.',
  tablet: 'Designed to assist with directions and information, with a tablet display and interactive gestures.',
  triangle: 'Explore MEETA’s humanoid form, animated head movements and articulated hands.'
};

// Browser-local photo studio: backgrounds never leave the visitor's device.
const studioPanel = $('studio-panel');
const studioToggle = $('studio-toggle');
const stageElement = $('stage');
const sceneNote = $('scene-note');
const photoModal = $('photo-preview');
let sceneBackground = { mode: 'light', color: '#e9f7ff', image: null, imageURL: null };
let latestPhotoURL = null;
let captureBusy = false;

function showStudioPanel(open, moveFocus = true) {
  if (open && !$('motion-panel').hidden) {
    $('motion-panel').hidden = true;
    $('motion-toggle').setAttribute('aria-expanded', 'false');
  }
  studioPanel.hidden = !open;
  studioToggle.setAttribute('aria-expanded', String(open));
  if (moveFocus) (open ? $('studio-close') : studioToggle).focus();
}

function updateSceneButtons() {
  for (const b of document.querySelectorAll('[data-scene]'))
    b.setAttribute('aria-pressed', String(b.dataset.scene === sceneBackground.mode));
  $('scene-remove-image').hidden = !sceneBackground.image;
}

function applyScene() {
  stageElement.dataset.scene = sceneBackground.mode;
  stageElement.style.setProperty('--scene-colour', sceneBackground.color);
  if (sceneBackground.imageURL) {
    stageElement.style.setProperty('--scene-image', `url("${sceneBackground.imageURL}")`);
  } else {
    stageElement.style.removeProperty('--scene-image');
  }
  stage?.setBackdropMode(sceneBackground.mode);
  updateSceneButtons();
}

for (const b of document.querySelectorAll('[data-scene]')) {
  b.addEventListener('click', () => {
    sceneBackground.mode = b.dataset.scene;
    applyScene();
    sceneNote.textContent = sceneBackground.mode === 'dark' ? 'Black scene selected for the 3D viewport.' : 'Light studio scene selected.';
  });
}
$('scene-color').addEventListener('input', event => {
  sceneBackground.color = event.target.value;
  sceneBackground.mode = 'custom';
  applyScene();
  sceneNote.textContent = 'Custom colour applied to the viewport.';
});
$('scene-upload').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    sceneNote.textContent = 'Choose a PNG, JPG, WebP or GIF image under 12 MB.';
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (sceneBackground.imageURL) URL.revokeObjectURL(sceneBackground.imageURL);
    sceneBackground.imageURL = url;
    sceneBackground.image = img;
    sceneBackground.mode = 'image';
    applyScene();
    sceneNote.textContent = `Background applied: ${file.name}. You can capture a photo now.`;
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    sceneNote.textContent = 'This image could not be opened. Try a different file.';
  };
  img.src = url;
});
$('scene-remove-image').addEventListener('click', () => {
  if (sceneBackground.imageURL) URL.revokeObjectURL(sceneBackground.imageURL);
  sceneBackground.imageURL = null;
  sceneBackground.image = null;
  sceneBackground.mode = 'light';
  applyScene();
  sceneNote.textContent = 'Uploaded background removed.';
});
for (const b of document.querySelectorAll('[data-photo-angle]')) {
  b.addEventListener('click', () => stage?.viewFrom(b.dataset.photoAngle));
}

function photoFilename() {
  const date = new Date();
  const stamp = [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('');
  return `MEETA_${active}_${stamp}.png`;
}
function downloadPhoto(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = photoFilename();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
function closePhotoModal() {
  photoModal.hidden = true;
  $('photo-preview-button').focus();
}
async function makePhoto(preview) {
  if (!stage?.robot || captureBusy) {
    if (!stage?.robot) sceneNote.textContent = 'Load a robot before capturing a photo.';
    return;
  }
  captureBusy = true;
  $('photo-preview-button').disabled = true;
  $('photo-capture-button').disabled = true;
  sceneNote.textContent = 'Preparing MEETA photo…';
  try {
    const blob = await stage.captureComposite(sceneBackground);
    const url = URL.createObjectURL(blob);
    if (latestPhotoURL) URL.revokeObjectURL(latestPhotoURL);
    latestPhotoURL = url;
    if (preview) {
      $('photo-preview-image').src = url;
      photoModal.hidden = false;
      $('photo-preview-close').focus();
      sceneNote.textContent = 'Preview ready. Save the PNG or adjust the camera.';
    } else {
      downloadPhoto(url);
      sceneNote.textContent = 'MEETA PNG captured.';
    }
  } catch (error) {
    sceneNote.textContent = error?.message || 'Could not capture the photo.';
  } finally {
    captureBusy = false;
    $('photo-preview-button').disabled = false;
    $('photo-capture-button').disabled = false;
  }
}

studioToggle.addEventListener('click', () => showStudioPanel(studioPanel.hidden));
$('studio-close').addEventListener('click', () => showStudioPanel(false));
$('photo-preview-button').addEventListener('click', () => makePhoto(true));
$('photo-capture-button').addEventListener('click', () => makePhoto(false));
$('photo-preview-close').addEventListener('click', closePhotoModal);
$('photo-retake').addEventListener('click', closePhotoModal);
$('photo-download').addEventListener('click', () => { if (latestPhotoURL) downloadPhoto(latestPhotoURL); });
photoModal.addEventListener('click', e => { if (e.target === photoModal) closePhotoModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!photoModal.hidden) closePhotoModal();
  else if (!studioPanel.hidden) showStudioPanel(false);
});

function showMotionPanel(open) {
  if (open && !$('studio-panel').hidden) showStudioPanel(false, false);
  motionPanel.hidden = !open;
  motionToggle.setAttribute('aria-expanded', String(open));
  if (open) $('motion-close').focus();
  else motionToggle.focus();
}

motionToggle.addEventListener('click', () => showMotionPanel(motionPanel.hidden));
$('motion-close').addEventListener('click', () => showMotionPanel(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !motionPanel.hidden) showMotionPanel(false);
});

function motionMessage(message) { $('motion-note').textContent = message; }
function updateMotionControls(key) {
  const plate = key === 'plate';
  $('tablet-controls').hidden = key !== 'tablet';
  for (const button of document.querySelectorAll('[data-free-arms]')) {
    button.disabled = plate;
    button.title = plate ? 'Plate model: tray and arm motions are locked' : '';
  }
  if (plate) motionMessage('Plate movement locked. Head motion is available.');
  else motionMessage('Move the pointer near the hands to guide the arms.');
}

for (const button of motionButtons) {
  button.addEventListener('click', () => {
    if (!stage) return;
    if (motionPaused) setMotionPaused(false);
    if (stage.gesture(button.dataset.gesture)) {
      motionMessage(button.textContent.trim() + ' gesture selected.');
    }
  });
}
$('motion-home').addEventListener('click', () => {
  stage?.resetPose();
  motionMessage('Robot pose reset.');
});
for (const button of document.querySelectorAll('[data-orientation]')) {
  button.addEventListener('click', () => {
    tabletOrientation = button.dataset.orientation;
    for (const option of document.querySelectorAll('[data-orientation]')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    stage?.tabletOrientation(tabletOrientation);
    motionMessage('Tablet: ' + (tabletOrientation === 'landscape' ? 'horizontal' : 'vertical') + '.');
  });
}
function setMotionPaused(on) {
  motionPaused = on;
  stage?.setMotionPaused(on);
  $('pause-motion').setAttribute('aria-pressed', String(on));
  $('pause-motion').textContent = on ? '▶ Resume' : 'Ⅱ Pause';
}
$('auto-motion').addEventListener('click', () => {
  autoMotionEnabled = !autoMotionEnabled;
  stage?.setAutoMotion(autoMotionEnabled);
  $('auto-motion').setAttribute('aria-pressed', String(autoMotionEnabled));
  $('auto-motion').innerHTML = '<span class="setting-indicator"></span> Auto motion: ' + (autoMotionEnabled ? 'On' : 'Off');
  motionMessage(autoMotionEnabled ? 'Auto demonstration enabled.' : 'Auto demonstration disabled.');
});
$('pause-motion').addEventListener('click', () => {
  setMotionPaused(!motionPaused);
  motionMessage(motionPaused ? 'Robot motion paused.' : 'Robot motion resumed.');
});

function showStatus(state, title = '', detail = '', retry = false) {
  status.hidden = state === 'ready';
  status.dataset.state = state;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('retry').hidden = !retry;
  panel.setAttribute('aria-busy', String(state === 'loading'));
  for (const button of tools) button.disabled = state !== 'ready';
}

function selectTab(key) {
  for (const tab of tabs) {
    const selected = tab.dataset.model === key;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) panel.setAttribute('aria-labelledby', tab.id);
  }
}

async function openModel(key, force = false) {
  if (key === active && !force) return;
  active = key;
  selectTab(key);
  $('variant-description').textContent = descriptions[key];
  updateMotionControls(key);
  request?.abort();
  const current = new AbortController();
  request = current;
  const { file, label } = MODELS[key];
  const url = new URL('./models/' + encodeURIComponent(file), document.baseURI);
  showStatus('loading', 'Loading ' + label + '…');
  if (!stage) {
    try {
      stage = new Stage(canvas, part => {
        $('part-name').textContent = PART_LABELS[part] || 'Full assembly';
      });
      stage.setBackdropMode(sceneBackground.mode);
    } catch {
      showStatus('error', '3D display unavailable', 'Open this page in a WebGL 2 browser with hardware acceleration enabled.', true);
      return;
    }
  }
  stage.setRobot(null);
  try {
    const response = await fetch(url, { signal: current.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status + '. Check models/' + file);
    const bytes = await response.arrayBuffer();
    // Static hosts sometimes return their HTML fallback page for a missing GLB.
    if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) {
      throw new Error('Expected a GLB binary at models/' + file);
    }
    if (current.signal.aborted) return;
    const gltf = await loader.parseAsync(bytes, new URL('.', url).href);
    if (current.signal.aborted) return;
    const robot = createRobot(gltf, key);
    stage.setRobot(robot);
    stage.setAutoMotion(autoMotionEnabled);
    stage.setMotionPaused(motionPaused);
    if (key === 'tablet') stage.tabletOrientation(tabletOrientation);
    showStatus('ready');
  } catch (error) {
    if (current.signal.aborted) return;
    const detail = error instanceof TypeError
      ? 'Check the connection and the file at models/' + file
      : error.message;
    showStatus('error', 'Could not open ' + label, detail, true);
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => openModel(tab.dataset.model));
  tab.addEventListener('keydown', event => {
    let next = index;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    tabs[next].focus();
    openModel(tabs[next].dataset.model);
  });
}
$('retry').addEventListener('click', () => openModel(active, true));
$('zoom-out').addEventListener('click', () => stage?.zoom(1 / 0.82));
$('zoom-in').addEventListener('click', () => stage?.zoom(0.82));
$('reset').addEventListener('click', () => stage?.resetView());
$('view-front').addEventListener('click', () => stage?.viewFrom('front'));
$('view-top').addEventListener('click', () => stage?.viewFrom('top'));
$('view-bottom').addEventListener('click', () => stage?.viewFrom('bottom'));
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  request?.abort();
  showStatus('error', '3D display interrupted', 'The viewer will reload the model when graphics are available again.');
});
canvas.addEventListener('webglcontextrestored', () => openModel(active, true));

const fullscreen = $('fullscreen');
if (document.fullscreenEnabled && $('explorer').requestFullscreen) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('explorer').requestFullscreen();
    } catch {
      // An embedding page can disable the Fullscreen API.
      fullscreen.hidden = true;
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const expanded = Boolean(document.fullscreenElement);
    fullscreen.setAttribute('aria-pressed', String(expanded));
    fullscreen.querySelector('span').textContent = expanded ? 'Exit fullscreen' : 'Fullscreen';
    fullscreen.querySelector('use').setAttribute('href', expanded ? '#i-collapse' : '#i-expand');
  });
}
openModel('plate');
