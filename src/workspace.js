import { WorkspaceStage } from './workspace-stage.js';

const $ = id => document.getElementById(id);
const canvas = $('factory-canvas');
const loading = $('factory-loading');
const loadingTitle = $('factory-loading-title');
const loadingDetail = $('factory-loading-detail');
const viewer = $('workspace-viewer');
const focusButtons = [...document.querySelectorAll('[data-focus]')];
const controls = ['play', 'pause', 'stop', 'zoom-in', 'zoom-out', 'view-front', 'view-top', 'view-bottom', 'fit'];
let stage;
let loadingNow = false;

function status(message) { $('factory-status').textContent = message; }
function updatePlaybackButtons() {
  const state = stage?.playback || 'stopped';
  $('play').setAttribute('aria-pressed', String(state === 'playing'));
  $('pause').setAttribute('aria-pressed', String(state === 'paused'));
  $('stop').setAttribute('aria-pressed', String(state === 'stopped'));
}
function markFocus(area) {
  for (const button of focusButtons)
    button.setAttribute('aria-pressed', String(button.dataset.focus === area));
}
function setReady(ready) {
  controls.forEach(id => { $(id).disabled = !ready; });
  focusButtons.forEach(button => { button.disabled = !ready; });
}
function showError(error) {
  console.error('MEETA workspace could not load:', error);
  loading.hidden = false;
  loadingTitle.textContent = 'Unable to open factory model';
  loadingDetail.textContent = 'Check that models/MEETA_Smart_Factory.glb is uploaded, then try again.';
  $('factory-retry').hidden = false;
  status('Model unavailable');
}

async function loadFactory() {
  if (loadingNow) return;
  loadingNow = true;
  setReady(false);
  loading.hidden = false;
  $('factory-retry').hidden = true;
  loadingTitle.textContent = 'Loading MEETA Smart Factory…';
  loadingDetail.textContent = 'Preparing 3D environment';
  try {
    if (!stage) stage = new WorkspaceStage(canvas, status);
    const model = await stage.load((percent, bytes) => {
      if (percent !== null && percent !== undefined) loadingDetail.textContent = `Loading model · ${percent}%`;
      else if (bytes) loadingDetail.textContent = `Loading model · ${(bytes / 1024 / 1024).toFixed(1)} MB received`;
    });
    loading.hidden = true;
    setReady(true);
    markFocus('overview');
    updatePlaybackButtons();
    status(`${model.animations.length} animation tracks · Overview`);
  } catch (error) { showError(error); }
  finally { loadingNow = false; }
}

for (const button of focusButtons) {
  button.addEventListener('click', () => {
    const area = button.dataset.focus;
    if (stage?.focus(area)) markFocus(area);
  });
}
$('play').addEventListener('click', () => { if (stage?.play()) { updatePlaybackButtons(); status('Factory animations playing'); } });
$('pause').addEventListener('click', () => { if (stage?.pause()) { updatePlaybackButtons(); status('Factory animations paused'); } });
$('stop').addEventListener('click', () => { if (stage?.stop()) { updatePlaybackButtons(); status('Factory animations reset to start'); } });
$('zoom-in').addEventListener('click', () => stage?.zoom(0.77));
$('zoom-out').addEventListener('click', () => stage?.zoom(1.3));
$('view-front').addEventListener('click', () => stage?.view('front'));
$('view-top').addEventListener('click', () => stage?.view('top'));
$('view-bottom').addEventListener('click', () => stage?.view('bottom'));
$('fit').addEventListener('click', () => { if (stage?.fit()) markFocus('overview'); });
$('factory-retry').addEventListener('click', loadFactory);

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === viewer) await document.exitFullscreen();
    else await viewer.requestFullscreen();
  } catch (error) { console.warn('Fullscreen unavailable:', error); status('Fullscreen is not supported in this browser'); }
}
$('fullscreen').addEventListener('click', toggleFullscreen);
$('stage-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === viewer;
  $('fullscreen').setAttribute('aria-pressed', String(active));
  $('stage-fullscreen').setAttribute('aria-pressed', String(active));
  $('stage-fullscreen').textContent = active ? '⤢' : '⛶';
  $('fullscreen').innerHTML = active ? '<span aria-hidden="true">⤢</span> Exit fullscreen' : '<span aria-hidden="true">⛶</span> Fullscreen';
  stage?.resize();
});
canvas.addEventListener('keydown', event => {
  if (!stage) return;
  const key = event.key.toLowerCase();
  if (key === 'f') { stage.view('front'); event.preventDefault(); }
  if (key === 't') { stage.view('top'); event.preventDefault(); }
  if (key === 'b') { stage.view('bottom'); event.preventDefault(); }
  if (key === 'r') { stage.fit(); markFocus('overview'); event.preventDefault(); }
  if (key === '+' || key === '=') { stage.zoom(0.77); event.preventDefault(); }
  if (key === '-') { stage.zoom(1.3); event.preventDefault(); }
});

setReady(false);
loadFactory();
window.addEventListener('pagehide', () => stage?.dispose(), { once: true });
