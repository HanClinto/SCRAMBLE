# SCRAMBLE

A browser-based experiment in real-time face detection and optical redaction. SCRAMBLE uses MediaPipe's BlazeFace detector to locate faces in a webcam feed, then rearranges each face into a shifting grid directly on a canvas.

Camera frames are processed locally in the browser. They are not recorded or uploaded.

## Run locally

The app is static, but camera access requires a secure context. `localhost` is considered secure by browsers:

```sh
npm start
```

Open the printed local URL and allow camera access.

## Deploy to GitHub Pages

Publish the repository root with any static Pages workflow. No build step is required. The app loads its pinned MediaPipe JavaScript, WASM runtime, model, and fonts from public CDNs at runtime.

## Browser support

Use a current Chromium, Firefox, or Safari release with WebAssembly, WebGL, canvas, and `getUserMedia()` support. The deployed site must use HTTPS.

## Current scope

- Multiple face detection with MediaPipe BlazeFace
- Shuffled grid redaction with adjustable fragmentation and coverage
- Conservative low-confidence detection with adjustable temporal persistence
- Opaque curved peripheral shielding to conceal partially visible edge faces
- Optional color-channel fracture effect
- Front/rear camera switching where the device exposes both cameras
- Experimental head-locked immersive WebXR presentation on compatible headsets
- Runtime diagnostics for WebXR capability, secure-context, and camera-track state
- Fresh reload control that cache-busts local assets and primary CDN dependencies
- Collapsible filter settings and independently scrollable controls for headset browsers
- Responsive desktop and mobile controls

The immersive mode presents the processed camera feed on a visor-sized plane attached to the WebXR viewer camera. It follows head movement, but remains a monoscopic view of the camera stream rather than true stereo passthrough. Browser support for keeping a webcam stream active during an immersive session is device-dependent.

This prototype performs face **detection**, not identification or recognition.

## License

MIT