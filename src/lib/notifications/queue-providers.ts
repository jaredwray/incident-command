import type { Qified, TaskProvider } from "qified";
import type { QueueProviderId } from "../domain/types";

/** The queue name for notification jobs. */
export const QUEUE_NAME = "incident-command.notifications";

/** The time a task may run before the provider sends it again. */
export const TASK_TIMEOUT_MS = 10 * 60 * 1000;

export type QueueRun = (
	jobId: string,
	keepAlive: () => Promise<void>,
) => Promise<void>;

export interface QueueTransport {
	enqueue(jobId: string): Promise<void>;
	consume(run: QueueRun): Promise<void>;
	close(): Promise<void>;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

type ErrorHandler = (error: unknown) => void;

function errorMethod(
	source: object,
	name: "on" | "off",
): ((event: "error", handler: ErrorHandler) => unknown) | undefined {
	const method: unknown = Reflect.get(source, name);
	if (typeof method !== "function") {
		return undefined;
	}
	return method.bind(source) as (
		event: "error",
		handler: ErrorHandler,
	) => unknown;
}

/** Logs provider errors. A missing listener can stop the process. */
export function listen(source: object, onError: (error: Error) => void): void {
	errorMethod(source, "on")?.("error", (error: unknown) =>
		onError(asError(error)),
	);
}

/**
 * Runs one queue call. Qified reports a failure as an error event and then
 * returns. This function rejects when that event fires. The listener stays
 * only for the call, because each task makes one call.
 */
export async function strict<T>(
	source: object,
	op: () => Promise<T>,
): Promise<T> {
	let failure: Error | undefined;
	const handler: ErrorHandler = (error) => {
		failure = asError(error);
	};
	errorMethod(source, "on")?.("error", handler);
	try {
		const result = await op();
		if (failure) {
			throw failure;
		}
		return result;
	} finally {
		errorMethod(source, "off")?.("error", handler);
	}
}

function jobIdOf(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null || !("jobId" in data)) {
		return undefined;
	}
	const id = data.jobId;
	return typeof id === "string" ? id : undefined;
}

/** A transport that uses qified tasks. */
export function taskTransport(
	qified: Qified,
	onError: (error: Error) => void,
): QueueTransport {
	listen(qified, onError);
	return {
		async enqueue(jobId) {
			const ids = await strict(qified, () =>
				qified.enqueue(QUEUE_NAME, {
					data: { jobId },
					timeout: TASK_TIMEOUT_MS,
					maxRetries: 3,
				}),
			);
			if (ids.length === 0) {
				throw new Error("The queue did not accept the task");
			}
		},
		async consume(run) {
			await strict(qified, () =>
				qified.dequeue(QUEUE_NAME, {
					id: "incident-command.notifications",
					handler: async (task, context) => {
						const jobId = jobIdOf(task.data);
						if (!jobId) {
							await context.reject(false);
							return;
						}
						try {
							await run(jobId, () => context.extend(TASK_TIMEOUT_MS));
							await context.ack();
						} catch {
							await context.reject(true);
						}
					},
				}),
			);
		},
		async close() {
			await qified.disconnect();
		},
	};
}

function taskOf(provider: TaskProvider, onError: (error: Error) => void) {
	listen(provider, onError);
	return import("qified").then(
		({ Qified }) => new Qified({ taskProviders: [provider] }),
	);
}

/**
 * Builds the transport for one provider. Each broker package loads only for
 * its own id.
 */
export async function createTransport(
	id: QueueProviderId,
	uri: string | undefined,
	onError: (error: Error) => void,
): Promise<QueueTransport> {
	const options = uri ? { uri } : {};
	switch (id) {
		case "redis": {
			const { RedisTaskProvider } = await import("@qified/redis");
			return taskTransport(
				await taskOf(new RedisTaskProvider(options), onError),
				onError,
			);
		}
		case "rabbitmq": {
			const { RabbitMqTaskProvider } = await import("@qified/rabbitmq");
			return taskTransport(
				await taskOf(new RabbitMqTaskProvider(options), onError),
				onError,
			);
		}
		case "nats": {
			const { NatsTaskProvider } = await import("@qified/nats");
			return taskTransport(
				await taskOf(new NatsTaskProvider(options), onError),
				onError,
			);
		}
	}
}
