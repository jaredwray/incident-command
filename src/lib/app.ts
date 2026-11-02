import { type Config, loadConfig } from "./config";
import { createNotifier, type Notifier } from "./notifications/notifier";
import { createServices, type Services } from "./services";
import type { CachedStore } from "./store/cached";
import { createStore } from "./store/factory";

export interface App {
	config: Config;
	store: CachedStore;
	notifier: Notifier;
	services: Services;
}

export interface CreateAppOptions {
	config?: Config;
	store?: CachedStore;
	notifier?: Notifier;
	now?: () => Date;
}

/** Wires configuration, storage, notifications and services together. */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
	const config = options.config ?? loadConfig();
	const store = options.store ?? (await createStore(config));
	const notifier = options.notifier ?? (await createNotifier(config));
	await store.connect();
	const services = createServices({
		store,
		notifier,
		config,
		now: options.now ?? (() => new Date()),
	});
	await services.bootstrap();
	return { config, store, notifier, services };
}

const globalForApp = globalThis as typeof globalThis & {
	__incidentCommand?: Promise<App>;
};

/**
 * Returns the process-wide app, creating it on first use. If creation fails
 * (for example the database is unreachable) the next call retries.
 */
export function getApp(): Promise<App> {
	globalForApp.__incidentCommand ??= createApp().catch((error: unknown) => {
		globalForApp.__incidentCommand = undefined;
		throw error;
	});
	return globalForApp.__incidentCommand;
}

/** Replaces (or clears) the process-wide app. Useful for tests. */
export function setApp(app: App | Promise<App> | undefined): void {
	globalForApp.__incidentCommand =
		app === undefined ? undefined : Promise.resolve(app);
}
