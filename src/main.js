import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRobot, MODELS, PART_LABELS } from './robot.js';
import { Stage } from './stage.js';

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panel = $('viewer-panel');
const canvas = $('viewport');
const status = $('status-box');
const tools = [$('zoom-out'), $('zoom-in'), $('view-top'), $('view-bottom'), $('reset')];
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

function showMotionPanel(open) {
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
