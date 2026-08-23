/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        /**
         * Google fetches this to verify app ownership. Without an explicit
         * content type Next would still serve it as JSON here (the extension
         * is right), but declaring it removes any doubt.
         */
        source: '/.well-known/assetlinks.json',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },

  // 'standalone' generates its own server that knows nothing about Socket.IO.
  // server.mjs is the entry point instead.
  reactStrictMode: true,
  poweredByHeader: false,
  // file-type and sharp are ESM/native and must not be bundled.
  serverExternalPackages: ['argon2', 'sharp', 'file-type'],
};
export default nextConfig;
