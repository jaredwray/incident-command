"use client";

import type { MouseEvent, ReactNode } from "react";
import { buttonClass } from "./ui";

/** A submit button that asks for confirmation before submitting its form. */
export function ConfirmButton({
	message,
	children,
	className = buttonClass.danger,
}: {
	message: string;
	children: ReactNode;
	className?: string;
}) {
	const onClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (!window.confirm(message)) {
			event.preventDefault();
		}
	};
	return (
		<button type="submit" onClick={onClick} className={className}>
			{children}
		</button>
	);
}
