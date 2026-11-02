import Link from "next/link";

export default function NotFound() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
			<p className="text-sm font-medium text-muted">404</p>
			<h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
			<p className="text-muted">The page you were looking for doesn't exist.</p>
			<Link
				href="/"
				className="mt-2 rounded-full bg-brand px-5 py-2 font-medium text-brand-fg"
			>
				Go to the status page
			</Link>
		</main>
	);
}
