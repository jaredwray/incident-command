"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that shows when its form is busy. While the server action of
 * the form runs, the button is disabled and shows a spinner. This prevents a
 * second submit and shows the user that the click had an effect.
 */
export function SubmitButton({
	children,
	className,
	onClick,
}: {
	children: ReactNode;
	/** Usually a `buttonClass` value. */
	className: string;
	onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
	const { pending } = useFormStatus();
	return (
		<button
			type="submit"
			disabled={pending}
			aria-busy={pending}
			onClick={onClick}
			className={`${className} disabled:cursor-wait`}
		>
			{pending && (
				<span
					aria-hidden="true"
					className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
				/>
			)}
			{children}
		</button>
	);
}
