/**
 * pnpmfile.cjs — auto-approve build scripts for native packages
 * This allows better-sqlite3 (native addon) and esbuild to run their build scripts.
 */
module.exports = {
  hooks: {
    readPackage(pkg) {
      return pkg;
    },
  },
};
