/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone tracing keeps the runtime image small: the Dockerfile copies
  // .next/standalone and does not need node_modules.
  output: 'standalone',

  // Pin the workspace root: there is an unrelated package-lock.json in the
  // user's home directory and Turbopack would otherwise infer that as root.
  turbopack: {
    root: __dirname,
  },

  // Native or non-bundlable packages must stay outside the server bundle.
  // @node-rs/argon2 ships a prebuilt .node binary per platform (arm64/amd64).
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],

  // Security headers. HSTS is intentionally absent: this deployment is plain
  // HTTP on a LAN / Tailscale, and forcing HSTS there would break access.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
