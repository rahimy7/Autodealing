// Metro has to look outside this package: `@workspace/api-client-react` ships raw
// TypeScript from `lib/`, so both the source files and the workspace-root
// node_modules must be visible to the bundler.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);

// Append, never replace: Expo puts its own paths in there.
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Hierarchical lookup stays ON: under pnpm every package keeps its own
// dependencies in a nested node_modules, and a package that imports one of them
// only resolves by walking up from its own directory.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
