const cacheToken = new URL(import.meta.url).searchParams.get('v');
const versionedUrl = (url) => cacheToken ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheToken)}` : url;
const MEDIAPIPE_URL = versionedUrl('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm');
const MODEL_NAME = 'BlazeFace full-range';
const MODEL_URL = versionedUrl('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite');
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const THREE_URL = versionedUrl('https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.min.js');
const DETECTION_INTERVAL = 80;

const video = document.querySelector('#camera-feed');
const canvas = document.querySelector('#output-canvas');
const context = canvas.getContext('2d', { alpha: false });
const startPanel = document.querySelector('#start-panel');
const startButton = document.querySelector('#start-button');
const errorMessage = document.querySelector('#error-message');
const statusText = document.querySelector('#status-text');
const statusDot = document.querySelector('#status-dot');
const faceCount = document.querySelector('#face-count');
const resolutionReadout = document.querySelector('#resolution-readout');
const scanOverlay = document.querySelector('#scan-overlay');
const cameraButton = document.querySelector('#camera-button');
const pauseButton = document.querySelector('#pause-button');
const immersiveButton = document.querySelector('#immersive-button');
const immersiveReason = document.querySelector('#immersive-reason');
const fullscreenButton = document.querySelector('#fullscreen-button');
const debugButton = document.querySelector('#debug-button');
const debugDialog = document.querySelector('#debug-dialog');
const debugCloseButton = document.querySelector('#debug-close-button');
const debugCopyButton = document.querySelector('#debug-copy-button');
const debugSummary = document.querySelector('#debug-summary');
const debugValues = document.querySelector('#debug-values');
const hardRefreshButton = document.querySelector('#hard-refresh-button');
const tileSize = document.querySelector('#tile-size');
const coverage = document.querySelector('#coverage');
const persistence = document.querySelector('#persistence');
const peripheralShield = document.querySelector('#peripheral-shield');
const refreshRate = document.querySelector('#refresh-rate');
const glitchToggle = document.querySelector('#glitch-toggle');

let detector;
let visionModulePromise;
let stream;
let animationFrame;
let trackedFaces = [];
let lastDetectionAt = 0;
let lastVideoTime = -1;
let facingMode = 'user';
let paused = false;
let shuffleSeed = 1;
let nextShuffleAt = 0;
let immersiveSupported = false;
let immersiveSupportState = 'checking';
let immersiveSupportError = '';
let immersiveSession;
let immersiveRenderer;
let immersiveRequestPending = false;

function getLiveVideoTrack() {
  return stream?.getVideoTracks().find((track) => track.readyState === 'live');
}

function getImmersiveGate() {
  if (!window.isSecureContext) return { ready: false, reason: 'Blocked: page is not a secure context' };
  if (!navigator.xr) return { ready: false, reason: 'Blocked: WebXR API is unavailable' };
  if (immersiveSupportState === 'checking') return { ready: false, reason: 'Checking immersive VR support…' };
  if (immersiveSupportState === 'error') return { ready: false, reason: `WebXR check failed: ${immersiveSupportError}` };
  if (!immersiveSupported) return { ready: false, reason: 'Blocked: immersive-vr is unsupported' };
  if (immersiveSession) return { ready: true, reason: 'Immersive session active' };
  if (!getLiveVideoTrack()) return { ready: false, reason: 'Ready for WebXR; initialize camera first' };
  if (immersiveRequestPending) return { ready: false, reason: 'Entering immersive view…' };
  return { ready: true, reason: 'Ready for immersive view' };
}

function updateImmersiveGate() {
  const gate = getImmersiveGate();
  immersiveButton.disabled = !gate.ready;
  immersiveButton.title = gate.reason;
  immersiveReason.textContent = gate.reason;
  immersiveReason.className = `immersive-reason ${gate.ready ? 'ready' : 'blocked'}`;
  if (debugDialog.open) renderDiagnostics();
}

function diagnosticEntries() {
  const track = stream?.getVideoTracks()[0];
  const liveTrack = getLiveVideoTrack();
  const settings = track?.getSettings?.() || {};
  return [
    ['Page', location.href],
    ['Cache token', cacheToken || 'none'],
    ['Face detector', MODEL_NAME],
    ['Secure context', String(window.isSecureContext), window.isSecureContext],
    ['WebXR API', navigator.xr ? 'available' : 'unavailable', Boolean(navigator.xr)],
    ['immersive-vr check', immersiveSupportState === 'complete' ? String(immersiveSupported) : immersiveSupportState, immersiveSupported],
    ['WebXR error', immersiveSupportError || 'none'],
    ['Immersive gate', getImmersiveGate().reason, getImmersiveGate().ready],
    ['Camera stream', liveTrack ? 'live' : stream ? 'no live video track' : 'unavailable', Boolean(liveTrack)],
    ['Video track', track ? `${track.label || 'unlabeled'} / ${track.readyState}` : 'none', track?.readyState === 'live'],
    ['Track enabled / muted', track ? `${track.enabled} / ${track.muted}` : 'n/a'],
    ['Camera settings', track ? `${settings.width || '?'} × ${settings.height || '?'} @ ${settings.frameRate || '?'} fps / ${settings.facingMode || 'unknown'}` : 'n/a'],
    ['Video element', `${video.readyState} / ${video.videoWidth || 0} × ${video.videoHeight || 0}`],
    ['WebGL2', String(Boolean(document.createElement('canvas').getContext('webgl2')))],
    ['User agent', navigator.userAgent],
  ];
}

function diagnosticsReport() {
  return diagnosticEntries().map(([label, value]) => `${label}: ${value}`).join('\n');
}

function renderDiagnostics() {
  const gate = getImmersiveGate();
  debugSummary.textContent = gate.reason;
  debugSummary.className = `debug-summary ${gate.ready ? '' : 'blocked'}`;
  debugValues.replaceChildren(...diagnosticEntries().flatMap(([label, value, good]) => {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    if (typeof good === 'boolean') description.className = good ? 'good' : 'bad';
    return [term, description];
  }));
}

function setStatus(message, state = '') {
  statusText.textContent = message;
  statusDot.className = `status-dot ${state}`;
}

function updateControlReadouts() {
  document.querySelector('#tile-size-value').value = `${tileSize.value} × ${Number(tileSize.value) + 1}`;
  document.querySelector('#coverage-value').value = `${coverage.value}%`;
  document.querySelector('#persistence-value').value = `${persistence.value} ms`;
  document.querySelector('#peripheral-shield-value').value = `${peripheralShield.value}%`;
  document.querySelector('#refresh-rate-value').value = `${refreshRate.value} ms`;
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => ((value = value * 16807 % 2147483647) - 1) / 2147483646;
}

function shuffledIndices(length, seed) {
  const random = seededRandom(seed);
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [indices[index], indices[target]] = [indices[target], indices[index]];
  }
  return indices;
}

function expandedBox(box) {
  const padding = Number(coverage.value) / 100;
  const width = box.width * (1 + padding * 2);
  const height = box.height * (1 + padding * 2.25);
  return {
    x: Math.max(0, box.originX - box.width * padding),
    y: Math.max(0, box.originY - box.height * padding * 1.15),
    width: Math.min(width, video.videoWidth),
    height: Math.min(height, video.videoHeight),
  };
}

function boxIntersectionOverUnion(first, second) {
  const left = Math.max(first.originX, second.originX);
  const top = Math.max(first.originY, second.originY);
  const right = Math.min(first.originX + first.width, second.originX + second.width);
  const bottom = Math.min(first.originY + first.height, second.originY + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union ? intersection / union : 0;
}

function smoothBox(previous, next) {
  const nextWeight = .42;
  const previousWeight = 1 - nextWeight;
  return {
    originX: previous.originX * previousWeight + next.originX * nextWeight,
    originY: previous.originY * previousWeight + next.originY * nextWeight,
    width: previous.width * previousWeight + next.width * nextWeight,
    height: previous.height * previousWeight + next.height * nextWeight,
  };
}

function updateTrackedFaces(detections, now) {
  const unmatchedTracks = new Set(trackedFaces.map((_, index) => index));

  detections.forEach((detection) => {
    let bestTrackIndex = -1;
    let bestOverlap = .12;

    unmatchedTracks.forEach((trackIndex) => {
      const overlap = boxIntersectionOverUnion(trackedFaces[trackIndex].box, detection.boundingBox);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestTrackIndex = trackIndex;
      }
    });

    if (bestTrackIndex >= 0) {
      const track = trackedFaces[bestTrackIndex];
      track.box = smoothBox(track.box, detection.boundingBox);
      track.lastSeen = now;
      unmatchedTracks.delete(bestTrackIndex);
    } else {
      trackedFaces.push({ box: detection.boundingBox, lastSeen: now });
    }
  });

  trackedFaces = trackedFaces.filter((track) => now - track.lastSeen <= Number(persistence.value));
}

function drawScramble(box, detectionIndex) {
  const region = expandedBox(box);
  const columns = Number(tileSize.value);
  const rows = columns + 1;
  const cellWidth = region.width / columns;
  const cellHeight = region.height / rows;
  const order = shuffledIndices(columns * rows, shuffleSeed + detectionIndex * 997);

  context.save();
  context.beginPath();
  context.ellipse(region.x + region.width / 2, region.y + region.height / 2, region.width * .52, region.height * .54, 0, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#171b18';
  context.fillRect(region.x, region.y, region.width, region.height);

  order.forEach((sourceIndex, destinationIndex) => {
    const sourceColumn = sourceIndex % columns;
    const sourceRow = Math.floor(sourceIndex / columns);
    const destinationColumn = destinationIndex % columns;
    const destinationRow = Math.floor(destinationIndex / columns);
    const sourceX = region.x + sourceColumn * cellWidth;
    const sourceY = region.y + sourceRow * cellHeight;
    const destinationX = region.x + destinationColumn * cellWidth;
    const destinationY = region.y + destinationRow * cellHeight;
    const jitter = ((destinationIndex + shuffleSeed) % 3 - 1) * cellWidth * .08;

    context.drawImage(video, sourceX, sourceY, cellWidth + 1, cellHeight + 1, destinationX + jitter, destinationY, cellWidth + 1, cellHeight + 1);
  });

  if (glitchToggle.checked) {
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = .22;
    context.filter = 'hue-rotate(78deg) saturate(1.8)';
    context.drawImage(canvas, region.x, region.y, region.width, region.height, region.x + cellWidth * .14, region.y, region.width, region.height);
    context.filter = 'none';
  }

  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.strokeStyle = 'rgba(199, 255, 69, .72)';
  context.lineWidth = Math.max(1, video.videoWidth / 900);
  for (let column = 1; column < columns; column += 1) {
    context.beginPath();
    context.moveTo(region.x + column * cellWidth, region.y);
    context.lineTo(region.x + column * cellWidth, region.y + region.height);
    context.stroke();
  }
  context.restore();
}

function createAperturePath(horizontalInset, verticalInset) {
  const width = canvas.width;
  const height = canvas.height;
  const left = horizontalInset;
  const right = width - horizontalInset;
  const top = verticalInset;
  const bottom = height - verticalInset;
  const corner = Math.min(width, height) * .12;
  const sideBow = width * .012;
  const verticalBow = height * .018;
  const path = new Path2D();

  path.moveTo(left + corner, top);
  path.bezierCurveTo(width * .36, top - verticalBow, width * .64, top - verticalBow, right - corner, top);
  path.quadraticCurveTo(right, top, right + sideBow, top + corner);
  path.bezierCurveTo(right + sideBow * 1.8, height * .38, right + sideBow * 1.8, height * .62, right + sideBow, bottom - corner);
  path.quadraticCurveTo(right, bottom, right - corner, bottom);
  path.bezierCurveTo(width * .64, bottom + verticalBow, width * .36, bottom + verticalBow, left + corner, bottom);
  path.quadraticCurveTo(left, bottom, left - sideBow, bottom - corner);
  path.bezierCurveTo(left - sideBow * 1.8, height * .62, left - sideBow * 1.8, height * .38, left - sideBow, top + corner);
  path.quadraticCurveTo(left, top, left + corner, top);
  path.closePath();

  return path;
}

function drawPeripheralShield() {
  const shieldRatio = Number(peripheralShield.value) / 100;
  const horizontalInset = canvas.width * shieldRatio;
  const verticalInset = canvas.height * Math.max(.055, shieldRatio * .52);
  const aperture = createAperturePath(horizontalInset, verticalInset);
  const mask = new Path2D();

  mask.rect(0, 0, canvas.width, canvas.height);
  mask.addPath(aperture);

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#080b09';
  context.fill(mask, 'evenodd');

  context.strokeStyle = 'rgba(199, 255, 69, .16)';
  context.lineWidth = Math.max(2, canvas.width * .004);
  context.shadowColor = 'rgba(199, 255, 69, .34)';
  context.shadowBlur = Math.max(8, canvas.width * .014);
  context.stroke(aperture);

  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(237, 241, 235, .25)';
  context.lineWidth = Math.max(1, canvas.width * .0012);
  context.stroke(aperture);
  context.restore();
}

function drawProcessedFrame(now) {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  if (!paused && video.currentTime !== lastVideoTime && now - lastDetectionAt >= DETECTION_INTERVAL) {
    try {
      updateTrackedFaces(detector.detectForVideo(video, now).detections, now);
      lastVideoTime = video.currentTime;
      lastDetectionAt = now;
    } catch (error) {
      console.error('Face detection failed:', error);
    }
  }

  if (now >= nextShuffleAt) {
    shuffleSeed += 1;
    nextShuffleAt = now + Number(refreshRate.value);
  }

  context.save();
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  trackedFaces.forEach((track, index) => drawScramble(track.box, index));
  context.restore();
  drawPeripheralShield();

  faceCount.textContent = String(trackedFaces.length).padStart(2, '0');
  setStatus(paused ? 'FEED PAUSED' : trackedFaces.length ? 'FILTER ACTIVE' : 'SCANNING', 'active');
}

function renderFrame(now) {
  drawProcessedFrame(now);
  animationFrame = requestAnimationFrame(renderFrame);
}

async function enterImmersive() {
  if (!getImmersiveGate().ready) return;
  if (immersiveSession) {
    await immersiveSession.end();
    return;
  }

  immersiveRequestPending = true;
  updateImmersiveGate();
  setStatus('ENTERING IMMERSIVE');
  let session;

  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor'],
    });
    const THREE = await import(THREE_URL);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080b09);

    const camera = new THREE.PerspectiveCamera(70, 16 / 9, .01, 10);
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.setFramebufferScaleFactor(.9);
    renderer.domElement.className = 'xr-render-surface';
    document.body.appendChild(renderer.domElement);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;

    const visor = new THREE.Mesh(
      new THREE.PlaneGeometry(2.65, 2.65 * 9 / 16),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    visor.position.set(0, 0, -1.05);
    camera.add(visor);

    immersiveSession = session;
    immersiveRenderer = renderer;
    immersiveRequestPending = false;
    updateImmersiveGate();
    cancelAnimationFrame(animationFrame);

    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
      immersiveSession = undefined;
      immersiveRenderer = undefined;
      immersiveButton.lastChild.textContent = ' Enter immersive';
      updateImmersiveGate();
      animationFrame = requestAnimationFrame(renderFrame);
    }, { once: true });

    await renderer.xr.setSession(session);
    immersiveButton.lastChild.textContent = ' Exit immersive';
    renderer.setAnimationLoop((time) => {
      drawProcessedFrame(time);
      texture.needsUpdate = true;
      renderer.render(scene, camera);
    });
  } catch (error) {
    immersiveRequestPending = false;
    updateImmersiveGate();
    if (session) await session.end();
    throw error;
  }
}

async function detectImmersiveSupport() {
  if (!navigator.xr) {
    immersiveSupportState = 'unavailable';
    updateImmersiveGate();
    return;
  }
  try {
    immersiveSupported = await navigator.xr.isSessionSupported('immersive-vr');
    immersiveSupportState = 'complete';
  } catch (error) {
    immersiveSupportState = 'error';
    immersiveSupportError = `${error.name || 'Error'}: ${error.message || 'No message'}`;
    console.warn('Unable to determine immersive WebXR support:', error);
  }
  updateImmersiveGate();
}

async function loadDetector() {
  if (detector) return;
  setStatus('LOADING VISION CORE');
  visionModulePromise ||= import(MEDIAPIPE_URL);
  const { FaceDetector, FilesetResolver } = await visionModulePromise;
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.35,
    minSuppressionThreshold: 0.3,
  });
}

async function startCamera() {
  startButton.disabled = true;
  cameraButton.disabled = true;
  errorMessage.textContent = '';
  setStatus('REQUESTING CAMERA');

  try {
    await loadDetector();
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    updateImmersiveGate();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    });
    video.srcObject = stream;
    getLiveVideoTrack()?.addEventListener('ended', updateImmersiveGate, { once: true });
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    resolutionReadout.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    trackedFaces = [];
    startPanel.classList.add('hidden');
    scanOverlay.classList.add('active');
    cameraButton.disabled = false;
    pauseButton.disabled = false;
    updateImmersiveGate();
    paused = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(renderFrame);
  } catch (error) {
    console.error(error);
    const denied = error.name === 'NotAllowedError';
    errorMessage.textContent = denied
      ? 'Camera permission was denied. Allow access in your browser settings and try again.'
      : `Unable to initialize: ${error.message || error.name}`;
    setStatus('INITIALIZATION FAILED', 'error');
  } finally {
    startButton.disabled = false;
    cameraButton.disabled = !getLiveVideoTrack();
    updateImmersiveGate();
  }
}

startButton.addEventListener('click', startCamera);
cameraButton.addEventListener('click', async () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  await startCamera();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  paused ? video.pause() : video.play();
  pauseButton.lastChild.textContent = paused ? ' Resume feed' : ' Pause feed';
});
immersiveButton.addEventListener('click', async () => {
  try {
    await enterImmersive();
  } catch (error) {
    console.error('Unable to enter immersive mode:', error);
    updateImmersiveGate();
    setStatus('IMMERSIVE FAILED', 'error');
  }
});
debugButton.addEventListener('click', () => {
  renderDiagnostics();
  debugDialog.showModal();
});
debugCloseButton.addEventListener('click', () => debugDialog.close());
debugDialog.addEventListener('click', (event) => {
  if (event.target === debugDialog) debugDialog.close();
});
debugCopyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(diagnosticsReport());
    debugCopyButton.textContent = 'Copied';
  } catch (error) {
    debugCopyButton.textContent = 'Copy unavailable';
  }
});
hardRefreshButton.addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.set('fresh', Date.now().toString());
  location.replace(url.href);
});
fullscreenButton.addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
});
[tileSize, coverage, persistence, peripheralShield, refreshRate].forEach((control) => control.addEventListener('input', updateControlReadouts));
window.addEventListener('pagehide', () => stream?.getTracks().forEach((track) => track.stop()));

updateControlReadouts();
detectImmersiveSupport();