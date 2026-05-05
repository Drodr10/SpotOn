const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle 3D model assets
config.resolver.assetExts.push('glb', 'gltf', 'mtl', 'obj', 'bin');

module.exports = config;
