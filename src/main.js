import { FaceDetector, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
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
const fullscreenButton = document.querySelector('#fullscreen-button');
const tileSize = document.querySelector('#tile-size');
const coverage = document.querySelector('#coverage');
const peripheralShield = document.querySelector('#peripheral-shield');
const refreshRate = document.querySelector('#refresh-rate');
const glitchToggle = document.querySelector('#glitch-toggle');

let detector;
let stream;
let animationFrame;
let detections = [];
let lastDetectionAt = 0;
let lastVideoTime = -1;
let facingMode = 'user';
let paused = false;
let shuffleSeed = 1;
let nextShuffleAt = 0;

function setStatus(message, state = '') {
  statusText.textContent = message;
  statusDot.className = `status-dot ${state}`;
}

function updateControlReadouts() {
  document.querySelector('#tile-size-value').value = `${tileSize.value} × ${Number(tileSize.value) + 1}`;
  document.querySelector('#coverage-value').value = `${coverage.value}%`;
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

function renderFrame(now) {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  if (!paused && video.currentTime !== lastVideoTime && now - lastDetectionAt >= DETECTION_INTERVAL) {
    try {
      detections = detector.detectForVideo(video, now).detections;
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
  detections.forEach((detection, index) => drawScramble(detection.boundingBox, index));
  context.restore();
  drawPeripheralShield();

  faceCount.textContent = String(detections.length).padStart(2, '0');
  setStatus(paused ? 'FEED PAUSED' : detections.length ? 'FILTER ACTIVE' : 'SCANNING', 'active');
  animationFrame = requestAnimationFrame(renderFrame);
}

async function loadDetector() {
  if (detector) return;
  setStatus('LOADING VISION CORE');
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.55,
    minSuppressionThreshold: 0.3,
  });
}

async function startCamera() {
  startButton.disabled = true;
  errorMessage.textContent = '';
  setStatus('REQUESTING CAMERA');

  try {
    await loadDetector();
    stream?.getTracks().forEach((track) => track.stop());
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
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    resolutionReadout.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    detections = [];
    startPanel.classList.add('hidden');
    scanOverlay.classList.add('active');
    cameraButton.disabled = false;
    pauseButton.disabled = false;
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
fullscreenButton.addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
});
[tileSize, coverage, peripheralShield, refreshRate].forEach((control) => control.addEventListener('input', updateControlReadouts));
window.addEventListener('pagehide', () => stream?.getTracks().forEach((track) => track.stop()));

updateControlReadouts();