/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
