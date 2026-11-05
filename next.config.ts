import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	serverExternalPackages: [
		"mongodb",
		"pg",
		// pg loads pg-cloudflare on Workers. The OpenNext build copies the full
		// package for its "workerd" export only when it is in this list.
		"pg-cloudflare",
		"@airhornjs/aws",
		"@airhornjs/twilio",
	],
};

export default nextConfig;
