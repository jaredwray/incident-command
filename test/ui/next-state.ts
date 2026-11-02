/** Shared state behind the mocked `next/headers` and `next/navigation` modules. */
export class Redirect extends Error {
	constructor(readonly url: string) {
		super(`NEXT_REDIRECT ${url}`);
	}
}

export class NotFound extends Error {
	constructor() {
		super("NEXT_NOT_FOUND");
	}
}

interface StoredCookie {
	name: string;
	value: string;
	[option: string]: unknown;
}

export class CookieJar {
	readonly store = new Map<string, StoredCookie>();
	get(name: string) {
		return this.store.get(name);
	}
	set(name: string, value: string, options: Record<string, unknown> = {}) {
		this.store.set(name, { name, value, ...options });
	}
	delete(name: string) {
		this.store.delete(name);
	}
}

export const cookieJar = new CookieJar();
export let requestHeaders = new Headers();

export function setRequestHeaders(init: Record<string, string>) {
	requestHeaders = new Headers(init);
}

export function resetNextState() {
	cookieJar.store.clear();
	requestHeaders = new Headers();
}
