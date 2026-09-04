// Device support gate for the editor window.
//
// This ran as an inline <script type="module"> in editor/index.html until the
// webview's CSP was tightened. `script-src` no longer carries 'unsafe-inline',
// so every script the editor runs has to be a file the bundle emits — which is
// the point: the editor renders user-authored patches, and inline script being
// forbidden is what stops an injected <script> from being executed at all.
//
// Load order matters and is preserved by the tag position: editor/index.html
// pulls this module in immediately before ../main.js, and module scripts run in
// document order, so the check is started first. It is asynchronous either way,
// so main.js does not assume it has finished — it polls the two window flags
// set below (see startWhenDeviceCheckReady in main.js).

import { DeviceDetector } from '../utils/DeviceDetector.js';

async function checkDeviceSupport() {
  const overlay = document.getElementById('device-warning-overlay');
  const titleEl = document.getElementById('warning-title');
  const messageEl = document.getElementById('warning-message');
  const detailsEl = document.getElementById('warning-details');
  const solutionsEl = document.getElementById('warning-solutions');

  const support = await DeviceDetector.checkSupport();

  if (!support.supported) {
    overlay.classList.add('show');

    let title = 'Device Not Supported';
    let message = 'This application requires a desktop browser with WebGPU support.';
    let details = '';
    let solutions = '';

    if (support.reason === 'mobile') {
      title = 'Mobile Device Detected';
      message = 'This application is designed for desktop computers and is not optimized for mobile devices.';
      details = `
        <strong>Device Type:</strong> ${support.details.deviceType}<br>
        <strong>Browser:</strong> ${support.details.browser}<br>
        <strong>WebGPU:</strong> ${support.details.webGPU ? 'Available' : 'Not Available'}
      `;
      solutions = `
        <h3>To use this application:</h3>
        <ul>
          <li>Please use a desktop or laptop computer</li>
          <li>Use Chrome 113+, Edge 113+, or Opera 99+</li>
          <li>Ensure WebGPU is enabled in your browser</li>
        </ul>
      `;
    } else if (support.reason === 'webgpu') {
      title = 'WebGPU Not Available';
      message = 'Your browser or device does not support WebGPU, which is required for this application.';
      details = `
        <strong>Browser:</strong> ${support.details.browser} ${support.details.browserVersion}<br>
        <strong>Device Type:</strong> ${support.details.deviceType}<br>
        <strong>Browser Supported:</strong> ${support.details.browserSupported ? 'Yes' : 'No'}
      `;
      solutions = `
        <h3>To enable WebGPU:</h3>
        <ul>
          <li><strong>Chrome/Edge:</strong> Update to version 113 or later</li>
          <li><strong>Chrome:</strong> Go to chrome://flags and enable "Unsafe WebGPU"</li>
          <li><strong>Opera:</strong> Update to version 99 or later</li>
          <li>Visit <a href="https://webgpu.io" target="_blank" style="color: var(--rz-accent);">webgpu.io</a> to test WebGPU support</li>
        </ul>
      `;
    } else if (support.reason === 'browser') {
      title = 'Unsupported Browser';
      message = `Your browser (${support.details.browser} ${support.details.browserVersion}) may not fully support this application.`;
      details = `
        <strong>Browser:</strong> ${support.details.browser} ${support.details.browserVersion}<br>
        <strong>Device Type:</strong> ${support.details.deviceType}<br>
        <strong>WebGPU:</strong> ${support.details.webGPU ? 'Available' : 'Not Available'}
      `;
      solutions = `
        <h3>Recommended browsers:</h3>
        <ul>
          <li><strong>Chrome 113+</strong> (Recommended)</li>
          <li><strong>Edge 113+</strong> (Recommended)</li>
          <li><strong>Opera 99+</strong></li>
          <li>Firefox and Safari have limited WebGPU support</li>
        </ul>
      `;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    detailsEl.innerHTML = details;
    solutionsEl.innerHTML = solutions;

    // Prevent app initialization
    window.__deviceCheckFailed = true;
  } else {
    // Device is supported, allow app to initialize
    window.__deviceCheckPassed = true;
  }
}

// "I Understand" dismisses the overlay. This was an onclick attribute on the
// button, which is inline script by another name and dies with the same CSP
// change; the behaviour is identical, it is just bound from here now.
document
  .getElementById('warning-dismiss')
  ?.addEventListener('click', () => {
    document.getElementById('device-warning-overlay')?.classList.remove('show');
  });

// Run device check immediately
checkDeviceSupport().catch(error => {
  console.error('Device check failed:', error);
  // On error, show warning but allow app to try loading
  document.getElementById('device-warning-overlay').classList.add('show');
  document.getElementById('warning-title').textContent = 'Device Check Failed';
  document.getElementById('warning-message').textContent = 'Unable to verify device compatibility. The application may not work correctly.';
});
