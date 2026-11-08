"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass } from "./ui";

type Action = () => Promise<{ url: string } | { error: string }>;

const linkClass =
	"w-56 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg focus:border-brand focus:outline-none sm:w-72";

/**
 * Writes text to the clipboard. Some browsers refuse a clipboard write that
 * starts after a wait for the server. Thus the write starts at once with a
 * promise of the text. A browser without `ClipboardItem` writes the text
 * when it is ready.
 */
async function writeWhenReady(text: Promise<string>): Promise<void> {
	if (typeof ClipboardItem === "function") {
		const blob = text.then(
			(value) => new Blob([value], { type: "text/plain" }),
		);
		return navigator.clipboard.write([
			new ClipboardItem({ "text/plain": blob }),
		]);
	}
	return navigator.clipboard.writeText(await text);
}

/** Selects the link so that the admin can copy it with the keyboard. */
function selectText(node: HTMLInputElement | null) {
	node?.focus();
	node?.select();
}

/**
 * Makes a new link for an open invite and copies it. When the browser does
 * not allow the copy, the page shows the link with a Copy button.
 */
export function CopyInviteLinkButton({ action }: { action: Action }) {
	const [pending, startTransition] = useTransition();
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string>();
	const [link, setLink] = useState<string>();
	const field = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (link) selectText(field.current);
	}, [link]);

	const renew = () =>
		startTransition(async () => {
			setCopied(false);
			setError(undefined);
			const result = action();
			// Start the write before the first await, while the click is active.
			const written = writeWhenReady(
				result.then((value) => {
					if ("error" in value) throw new Error(value.error);
					return value.url;
				}),
			).then(
				() => true,
				() => false,
			);
			const value = await result;
			if ("error" in value) {
				setError(value.error);
				return;
			}
			if (await written) setCopied(true);
			else setLink(value.url);
		});

	// The click on Copy is a new user action, so the browser allows the write.
	const copyLink = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
		} catch {
			selectText(field.current);
		}
	};

	return (
		<>
			{error && (
				<span role="alert" className="text-xs text-major">
					{error}
				</span>
			)}
			{link ? (
				<>
					<input
						ref={field}
						readOnly
						value={link}
						aria-label="New invite link"
						className={linkClass}
					/>
					<button
						type="button"
						onClick={() => copyLink(link)}
						className={buttonClass.secondary}
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</>
			) : (
				<button
					type="button"
					onClick={renew}
					disabled={pending}
					className={buttonClass.secondary}
				>
					{copied ? "Copied" : "Copy link"}
				</button>
			)}
		</>
	);
}
