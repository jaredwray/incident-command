import { setApp } from "@/lib/app";
import { resetNextState } from "./next-state";

vi.mock("next/headers", async () => {
	const state = await import("./next-state");
	return {
		cookies: async () => state.cookieJar,
		headers: async () => state.requestHeaders,
	};
});

vi.mock("next/navigation", async () => {
	const state = await import("./next-state");
	return {
		redirect: (url: string) => {
			throw new state.Redirect(url);
		},
		notFound: () => {
			throw new state.NotFound();
		},
	};
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

afterEach(() => {
	resetNextState();
	setApp(undefined);
});
