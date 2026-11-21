import type { QueueProviderId } from "../domain/types";
import type { QueueRun, QueueTransport } from "./queue-providers";

/** The time a broker call may take before the send continues here. */
const ENQUEUE_TIMEOUT_MS = 5000;

const loadProviders = () => import("./queue-providers");

/** Hides a user and a password in a connection URI. */
export function redactUri(message: string): string {
	return message.replace(/\/\/[^/\s]*@/g, "//***@");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("The queue did not answer in time"));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function ignore(): void {}

/**
 * One qified transport for the saved queue. The provider package loads on
 * the first open.
 */
export class NotificationQueue {
	private current?: { version: string; transport: QueueTransport };
	private last: Promise<unknown> = Promise.resolve();
	private readonly report: (error: Error) => void;
	private runner: QueueRun = async () => {};

	constructor(onError?: (error: Error) => void) {
		const log =
			onError ??
			((error: Error) => console.error(`[notifications] ${error.message}`));
		this.report = (error) => {
			log(new Error(redactUri(error.message), { cause: error }));
		};
	}

	/** The function that runs one job. Set it before the first open. */
	setRunner(runner: QueueRun): void {
		this.runner = runner;
	}

	/**
	 * Opens the saved provider and starts the consumer. `load` means the
	 * package or the broker did not open.
	 */
	open(
		provider: QueueProviderId,
		uri: string | undefined,
		revision: number,
	): Promise<"ok" | "load"> {
		return this.inOrder(async () => {
			const version = `${provider}:${revision}`;
			if (this.current?.version === version) {
				return "ok";
			}
			await this.release();
			const created = loadProviders().then(({ createTransport }) =>
				createTransport(provider, uri, this.report),
			);
			try {
				const transport = await withTimeout(
					created.then(async (transport) => {
						await transport.consume(this.runner);
						return transport;
					}),
					ENQUEUE_TIMEOUT_MS,
				);
				this.current = { version, transport };
				return "ok";
			} catch (error) {
				this.report(asError(error));
				// The transport can exist with no consumer, or the broker can
				// answer after the time limit. Close it, or it stays connected.
				void created.then((transport) => this.shut(transport), ignore);
				return "load";
			}
		});
	}

	/** Puts one job on the open queue. `enqueue` means the broker refused it. */
	async enqueue(jobId: string): Promise<"ok" | "enqueue"> {
		const transport = this.current?.transport;
		if (!transport) {
			return "enqueue";
		}
		try {
			await withTimeout(transport.enqueue(jobId), ENQUEUE_TIMEOUT_MS);
			return "ok";
		} catch (error) {
			this.report(asError(error));
			return "enqueue";
		}
	}

	close(): Promise<void> {
		return this.inOrder(() => this.release());
	}

	/**
	 * Runs one open or one close at a time. Two opens at the same time make
	 * two consumers, and only one of them closes.
	 */
	private inOrder<T>(step: () => Promise<T>): Promise<T> {
		const result = this.last.then(step);
		this.last = result.then(ignore, ignore);
		return result;
	}

	private async release(): Promise<void> {
		const current = this.current;
		this.current = undefined;
		if (current) {
			await this.shut(current.transport);
		}
	}

	/** Closes one transport. A broker that does not answer must not stop the next open. */
	private async shut(transport: QueueTransport): Promise<void> {
		try {
			await withTimeout(transport.close(), ENQUEUE_TIMEOUT_MS);
		} catch (error) {
			this.report(asError(error));
		}
	}
}
