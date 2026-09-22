import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 左下角常驻转圈的是 dev 编译指示器（仅 next dev，不进生产包）；编译错误仍会弹出
  devIndicators: false,
};

export default nextConfig;
