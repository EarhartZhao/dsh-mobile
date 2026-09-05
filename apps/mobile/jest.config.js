const preset = require('@react-native/jest-preset')

module.exports = {
  ...preset,
  // pnpm stores packages below `.pnpm/.../node_modules`; the preset's
  // default ignore expression misses that nested path and leaves the RN
  // setup file as untransformed ESM.
  transformIgnorePatterns: [],
}
