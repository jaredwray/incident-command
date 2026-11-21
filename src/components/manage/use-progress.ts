"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reads a JSON URL on a timer. An HTTP error stops the timer.
 * A network error tries again at the next interval.
 */
export function useProgress<T>(
	url: string | undefined,
	intervalMs: number,
	isDone: (value: T) => boolean,
): { data: T | undefined; error: boolean } {
	const [data, setData] = useState<T | undefined>();
	const [error, setError] = useState(false);
	const done = useRef(isDone);
	done.current = isDone;

	useEffect(() => {
		if (!url) {
			return;
		}
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const tick = async () => {
			try {
				const response = await fetch(url, {
					signal: controller.signal,
					cache: "no-store",
				});
				if (!response.ok) {
					setError(true);
					return;
				}
				const body = (await response.json()) as T;
				if (stopped) {
					return;
				}
				setData(body);
				setError(false);
				if (!done.current(body)) {
					timer = setTimeout(() => {
						void tick();
					}, intervalMs);
				}
			} catch {
				if (stopped) {
					return;
				}
				timer = setTimeout(() => {
					void tick();
				}, intervalMs);
			}
		};
		void tick();
		return () => {
			stopped = true;
			controller.abort();
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		};
	}, [url, intervalMs]);

	return { data, error };
}
