import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	experimental: {
		serverActions: {
			// The Branding form can send a logo and a favicon of 512 KB each
			// in one request. The default limit is 1 MB.
			bodySizeLimit: "2mb",
		},
	},
	async headers() {
		// Another site must not show the consent page in a frame (RFC 6749
		// section 10.13), because a click there connects an agent.
		return [
			{
				source: "/manage/authorize",
				headers: [
					{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
					{ key: "X-Frame-Options", value: "DENY" },
				],
			},
		];
	},
	async rewrites() {
		// An agent reads the Markdown version of an incident page at the URL
		// of the page with ".md" added (https://llmstxt.org).
		return [
			{
				source: "/incidents/:id\\.md",
				destination: "/incidents/:id/markdown",
			},
		];
	},
	async redirects() {
		// Older links and bookmarks point to the page under its old name.
		return [
			{
				source: "/manage/components",
				destination: "/manage/services",
				permanent: false,
			},
		];
	},
	// Node loads these packages from node_modules. airhorn is in the list
	// because the provider packages load it too, and one copy must load, not two.
	// qrbit loads a native addon from its package.
	serverExternalPackages: [
		"mongodb",
		"pg",
		"airhorn",
		"@airhornjs/aws",
		"@airhornjs/twilio",
		"qrbit",
		"qified",
		"@qified/redis",
		"@qified/rabbitmq",
		"@qified/nats",
	],
	// The standalone build must copy the qrbit addon. The loader picks the file by platform.
	outputFileTracingIncludes: {
		"/manage/account": ["./node_modules/qrbit/**/*"],
		"/manage/login/two-factor": ["./node_modules/qrbit/**/*"],
	},
};

export default nextConfig;
