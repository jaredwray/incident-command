const FILL = {
	brand: "bg-brand",
	operational: "bg-operational",
	major: "bg-major",
} as const;

/** A bar that shows how many notifications are complete. */
export function ProgressBar({
	value,
	max,
	tone,
}: {
	value: number;
	max: number;
	tone: keyof typeof FILL;
}) {
	const percent =
		max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
	return (
		<div
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
			className="h-2 overflow-hidden rounded-full bg-surface-muted"
		>
			<div
				className={`h-full ${FILL[tone]}`}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}
