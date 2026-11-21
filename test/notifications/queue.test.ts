import { NotificationQueue, redactUri } from "@/lib/notifications/queue";

const state = vi.hoisted(() => ({
	mode: "ok" as
		| "ok"
		| "hang"
		| "throw-string"
		| "throw-error"
		| "close-string"
		| "close-error"
		| "close-hang"
		| "enqueue-string"
		| "consume-hang"
		| "consume-error",
	calls: 0,
	closed: 0,
}));

vi.mock("@/lib/notifications/queue-providers", () => ({
	createTransport: () => {
		state.calls += 1;
		if (state.mode === "hang") {
			return new Promise(() => {});
		}
		if (state.mode === "throw-string") {
			throw "missing";
		}
		if (state.mode === "throw-error") {
			throw new Error("redis://user:secret@localhost:6379 failed");
		}
		return {
			enqueue: () => {
				if (state.mode === "hang") {
					return new Promise(() => {});
				}
				if (state.mode === "enqueue-string") {
					return Promise.reject("refused");
				}
				return Promise.resolve();
			},
			consume: async (
				run: (jobId: string, keepAlive: () => Promise<void>) => Promise<void>,
			) => {
				if (state.mode === "consume-hang") {
					return new Promise(() => {});
				}
				if (state.mode === "consume-error") {
					throw new Error("no consumer");
				}
				await run("njb_noop", async () => {});
			},
			close: async () => {
				state.closed += 1;
				if (state.mode === "close-hang") {
					return new Promise<void>(() => {});
				}
				if (state.mode === "close-string") {
					throw "closed";
				}
				if (state.mode === "close-error") {
					throw new Error("closed");
				}
			},
		};
	},
}));

describe("NotificationQueue", () => {
	beforeEach(() => {
		state.mode = "ok";
		state.calls = 0;
		state.closed = 0;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hides a user and a password", () => {
		expect(redactUri("down redis://user:secret@localhost/0")).toBe(
			"down redis://***@localhost/0",
		);
		expect(redactUri("no credentials")).toBe("no credentials");
	});

	it("opens one version once and enqueues on it", async () => {
		const queue = new NotificationQueue();
		await expect(queue.enqueue("njb_1")).resolves.toBe("enqueue");
		await expect(queue.open("redis", undefined, 1)).resolves.toBe("ok");
		await expect(queue.open("redis", undefined, 1)).resolves.toBe("ok");
		expect(state.calls).toBe(1);
		await expect(queue.enqueue("njb_1")).resolves.toBe("ok");
		await queue.close();
		await queue.close();
	});

	it("continues the send when the package does not load", async () => {
		state.mode = "hang";
		const errors: Error[] = [];
		const queue = new NotificationQueue((error) => errors.push(error));
		const pending = queue.open("redis", "redis://localhost:6379", 1);
		await vi.advanceTimersByTimeAsync(5000);
		await expect(pending).resolves.toBe("load");
		expect(errors[0]?.message).toContain("did not answer");
	});

	it("closes the transport when the consumer does not start", async () => {
		const errors: Error[] = [];
		const queue = new NotificationQueue((error) => errors.push(error));
		state.mode = "consume-error";
		await expect(queue.open("redis", undefined, 1)).resolves.toBe("load");
		await vi.waitFor(() => expect(state.closed).toBe(1));
		expect(errors.map((error) => error.message)).toEqual(["no consumer"]);

		state.mode = "consume-hang";
		const pending = queue.open("redis", undefined, 1);
		await vi.advanceTimersByTimeAsync(5000);
		await expect(pending).resolves.toBe("load");
		await vi.waitFor(() => expect(state.closed).toBe(2));
		await expect(queue.enqueue("njb_1")).resolves.toBe("enqueue");
	});

	it("runs one open or one close at a time", async () => {
		const queue = new NotificationQueue();
		await queue.open("redis", undefined, 1);
		await expect(
			Promise.all([
				queue.open("redis", undefined, 2),
				queue.open("redis", undefined, 2),
			]),
		).resolves.toEqual(["ok", "ok"]);
		expect(state.calls).toBe(2);
		expect(state.closed).toBe(1);

		const opening = queue.open("redis", undefined, 3);
		const closing = queue.close();
		await expect(opening).resolves.toBe("ok");
		await closing;
		expect(state.closed).toBe(3);
		await expect(queue.enqueue("njb_1")).resolves.toBe("enqueue");
	});

	it("opens the next provider when the old broker does not close", async () => {
		const errors: Error[] = [];
		const queue = new NotificationQueue((error) => errors.push(error));
		await queue.open("redis", undefined, 1);
		state.mode = "close-hang";
		const pending = queue.open("redis", undefined, 2);
		await vi.advanceTimersByTimeAsync(5000);
		await expect(pending).resolves.toBe("ok");
		expect(errors.map((error) => error.message)).toEqual([
			"The queue did not answer in time",
		]);
		state.mode = "ok";
		await expect(queue.enqueue("njb_1")).resolves.toBe("ok");
	});

	it("continues the send when the broker does not accept the task", async () => {
		state.mode = "ok";
		const queue = new NotificationQueue();
		await queue.open("redis", undefined, 1);
		state.mode = "hang";
		const pending = queue.enqueue("njb_1");
		await vi.advanceTimersByTimeAsync(5000);
		await expect(pending).resolves.toBe("enqueue");
		state.mode = "enqueue-string";
		await expect(queue.enqueue("njb_2")).resolves.toBe("enqueue");
	});

	it("redacts a broker error and accepts a string failure", async () => {
		const errors: Error[] = [];
		const queue = new NotificationQueue((error) => errors.push(error));
		state.mode = "throw-string";
		await expect(queue.open("redis", undefined, 1)).resolves.toBe("load");
		expect(errors.at(-1)?.message).toBe("missing");

		state.mode = "throw-error";
		state.calls = 0;
		await expect(queue.open("redis", "redis://localhost", 2)).resolves.toBe(
			"load",
		);
		expect(errors.at(-1)?.message).toBe("redis://***@localhost:6379 failed");
		expect(errors.at(-1)?.cause).toBeInstanceOf(Error);
	});

	it("reports a close failure and opens the next provider", async () => {
		const errors: Error[] = [];
		const logged: string[] = [];
		const queue = new NotificationQueue((error) => {
			errors.push(error);
			logged.push(error.message);
		});
		state.mode = "close-string";
		await queue.open("redis", undefined, 1);
		await expect(queue.open("redis", undefined, 2)).resolves.toBe("ok");
		expect(logged).toContain("closed");
		state.mode = "close-error";
		await expect(queue.open("redis", undefined, 4)).resolves.toBe("ok");
		expect(errors.some((error) => error.message === "closed")).toBe(true);
		const plain = new NotificationQueue();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		state.mode = "throw-error";
		await plain.open("redis", undefined, 3);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
