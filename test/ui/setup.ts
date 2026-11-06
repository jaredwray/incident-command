import { setApp } from "@/lib/app";
import { resetNextState } from "./next-state";

vi.mock("next/headers", async () => {
	const state = await import("./next-state");
	return {
		cookies: async () => state.cookieJar,
		headers: async () => state.requestHeaders,
	};
});

vi.mock("next/navigation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("next/navigation")>();
	const state = await import("./next-state");
	return {
		unstable_isUnrecognizedActionError:
			actual.unstable_isUnrecognizedActionError,
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
