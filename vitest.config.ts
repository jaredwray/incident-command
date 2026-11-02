import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
	plugins: [react()],
	resolve: { alias },
	test: {
		globals: true,
		setupFiles: ["./test/setup.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					include: ["test/**/*.test.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "ui",
					environment: "jsdom",
					include: ["test/**/*.test.tsx"],
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/**/*.d.ts"],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});
