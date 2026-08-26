const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Monorepo: watch shared packages and resolve deps from one React instance.
config.watchFolders = [monorepoRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force a single React copy — prevents "Cannot read property 'useEffect' of null".
const mobileModules = path.resolve(projectRoot, "node_modules");
const rootModules = path.resolve(monorepoRoot, "node_modules");
config.resolver.extraNodeModules = {
  react: path.join(rootModules, "react"),
  "react-dom": path.join(rootModules, "react-dom"),
  "react-native": path.join(mobileModules, "react-native"),
  semver: path.join(mobileModules, "semver"),
  "react-native-worklets": path.join(rootModules, "react-native-worklets"),
};

module.exports = config;
