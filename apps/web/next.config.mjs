/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stampdeck/shared"],
  output: "standalone",
};

export default nextConfig;
