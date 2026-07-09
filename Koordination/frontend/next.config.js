/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001',
    NEXT_PUBLIC_VERSION: '1.0',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BDih4eYw9e_vFUoS7KUXG8qT1-aUZ3tE1FPcC5rM2p_hfoeoDaOiWwxJapTBD3lDeyyL6-RGrnsUuvcADJk1AwU',
  },
}
module.exports = nextConfig
