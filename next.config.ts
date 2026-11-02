import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	serverExternalPackages: [
		"mongodb",
		"pg",
		"@airhornjs/aws",
		"@airhornjs/twilio",
	],
};

export default nextConfig;
