const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // pnpm monorepo: watch the workspace so @dsh-mobile/* (linked into
  // node_modules as symlinks) are transformed and hot-reloadable.
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // nats.ws bundles tweetnacl, whose `require('crypto')` PRNG fallback is
    // dead code under Hermes (react-native-get-random-values provides
    // globalThis.crypto first) but Metro still resolves it statically.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'crypto') {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
