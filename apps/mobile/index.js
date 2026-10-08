/**
 * @format
 */

/* eslint-disable */
// CommonJS requires, in this exact order (ES imports would hoist past the
// polyfill). nats.ws instantiates TextDecoder at module scope; Hermes has a
// native TextEncoder but no TextDecoder (RN 0.87), hence the local polyfill.
require('./src/vendor/text-decoder-polyfill');
// nats.ws parses server addresses with `new URL(...)`; Hermes has no URL.
require('react-native-url-polyfill/auto');
require('react-native-get-random-values');
// Keep the device token out of development console output (nats.ws traces
// every wire frame when `debug` is on; releases never enable it).
require('./src/dev-log-redaction').installConsoleRedaction();
// react-native-get-random-values only provides getRandomValues; the vendored
// carrier mints rpcIds with crypto.randomUUID, so fill the gap (RFC 4122 v4).
if (typeof globalThis.crypto !== 'object' || globalThis.crypto === null) {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = function randomUUID() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  };
}

const { AppRegistry, LogBox } = require('react-native');
const App = require('./src/App').default;
const { name: appName } = require('./app.json');

// The in-app overlay is RN's own English furniture — "Open debugger to view
// warnings." — and it covers the composer every time a warning lands, including
// on the first bundle of a reload. Its subjects are either third-party noise
// (@react-native/virtualized-lists' feature-flag subpath import, the extracted
// `Clipboard` getter) or things this app reports through its own top banner, so
// the phone keeps the terminal's copy of the warning instead of the overlay.
LogBox.ignoreAllLogs(true)

AppRegistry.registerComponent(appName, () => App);
