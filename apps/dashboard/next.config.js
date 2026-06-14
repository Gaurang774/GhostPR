/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' output is only needed for the Docker production image, which
  // copies .next/standalone. It symlinks traced deps during build, and Windows
  // blocks symlink creation without Developer Mode/admin (EPERM). Local
  // `pnpm build` and `pnpm dev` don't need it, so it's opt-in via env var —
  // the dashboard Dockerfile sets BUILD_STANDALONE=true.
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Force sql.js to load as CommonJS so `module` variable is defined
      // (sql.js sets module.exports which fails in ESM context)
      if (!config.externals) {
        config.externals = [];
      }
      if (Array.isArray(config.externals)) {
        config.externals.push({ 'sql.js': 'commonjs sql.js' });
      }
    } else {
      // Don't bundle Node.js built-ins on the client
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
