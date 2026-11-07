"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "./ui";

type Action = () => Promise<{ url: string } | { error: string }>;

/**
 * Makes a new link for an open invite and copies it. When the browser does
 * not allow the copy, a prompt shows the link so the admin can copy it.
 */
export function CopyInviteLinkButton({ action }: { action: Action }) {
	const [pending, startTransition] = useTransition();
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string>();
	const copy = () =>
		startTransition(async () => {
			setCopied(false);
			setError(undefined);
			const result = await action();
			if ("error" in result) {
				setError(result.error);
				return;
			}
			try {
				await navigator.clipboard.writeText(result.url);
				setCopied(true);
			} catch {
				window.prompt("Copy the invite link.", result.url);
			}
		});
	return (
		<>
			{error && (
				<span role="alert" className="text-xs text-major">
					{error}
				</span>
			)}
			<button
				type="button"
				onClick={copy}
				disabled={pending}
				className={buttonClass.secondary}
			>
				{copied ? "Copied" : "Copy link"}
			</button>
		</>
	);
}
