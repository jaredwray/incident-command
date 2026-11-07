"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

const buttonClass =
	"mt-2 rounded-full bg-brand px-5 py-2 font-medium text-brand-fg";

export default function ErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	// The server did not know the server action that the form sent. This
	// happens when a deploy changed the action ids after the browser loaded the
	// page. The stale page cannot recover with `reset`, only a reload gets the
	// new ids.
	const outdated = unstable_isUnrecognizedActionError(error);
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
			<h1 className="text-2xl font-semibold tracking-tight">
				{outdated ? "This page is out of date" : "Something went wrong"}
			</h1>
			<p className="text-muted">
				{outdated
					? "The site changed after this page loaded. Reload the page and try again."
					: "We couldn't load this page. Please try again in a moment."}
			</p>
			{outdated ? (
				<button
					type="button"
					onClick={() => window.location.reload()}
					className={buttonClass}
				>
					Reload
				</button>
			) : (
				<button type="button" onClick={reset} className={buttonClass}>
					Try again
				</button>
			)}
		</main>
	);
}
