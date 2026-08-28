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

const { AppRegistry } = require('react-native');
const App = require('./src/App').default;
const { name: appName } = require('./app.json');

AppRegistry.registerComponent(appName, () => App);
