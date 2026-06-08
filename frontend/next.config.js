/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: [
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/react"
  ],
  webpack: (config) => {
    config.module.rules.push({ test: /\.geojson$/, type: "json" });
    return config;
  }
};

module.exports = nextConfig;
