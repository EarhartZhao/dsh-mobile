module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // zod v4 ships `export * as ns` untranspiled; the RN preset leaves that
    // transform out for dependencies.
    '@babel/plugin-transform-export-namespace-from',
  ],
};
