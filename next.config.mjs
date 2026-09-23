/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // STEP 7 — "최종 이미지 만들기"가 합성된 PNG(최대 1080x1080)를 Server
    // Action 인자로 전달한다. 기본 1MB 제한을 넘는 경우가 많아 상향한다.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
