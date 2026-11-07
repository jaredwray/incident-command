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
	formAction,
}: {
	children: ReactNode;
	/** Usually a `buttonClass` value. */
	className: string;
	onClick?: MouseEventHandler<HTMLButtonElement>;
	/**
	 * The server action of this button, when a form has more than one. All
	 * buttons of the form are disabled while an action runs, but only the
	 * button that started it shows the spinner.
	 */
	formAction?: (form: FormData) => void | Promise<void>;
}) {
	const { pending, action } = useFormStatus();
	const busy = pending && (formAction === undefined || action === formAction);
	return (
		<button
			type="submit"
			disabled={pending}
			aria-busy={busy}
			onClick={onClick}
			formAction={formAction}
			className={`${className} disabled:cursor-wait`}
		>
			{busy && (
				<span
					aria-hidden="true"
					className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
				/>
			)}
			{children}
		</button>
	);
}
