"use client";

export default function ErrorPage({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
			<h1 className="text-2xl font-semibold tracking-tight">
				Something went wrong
			</h1>
			<p className="text-muted">
				We couldn't load this page. Please try again in a moment.
			</p>
			<button
				type="button"
				onClick={reset}
				className="mt-2 rounded-full bg-brand px-5 py-2 font-medium text-brand-fg"
			>
				Try again
			</button>
		</main>
	);
}
