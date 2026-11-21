"use client";

import { useEffect, useState } from "react";
import type { NotificationProgress } from "@/lib/domain/types";
import { ProgressBar } from "./progress-bar";
import { useProgress } from "./use-progress";

type Props = { incidentId: string; initial: NotificationProgress };

/**
 * A banner for the incident dashboard. It updates while the queue sends.
 * Each server render gives a new `initial`. The banner then starts again,
 * because a new send can be active.
 */
export function SendProgressBanner({ incidentId, initial }: Props) {
	const [shown, setShown] = useState({ initial, turn: 0 });
	if (shown.initial !== initial) {
		setShown({ initial, turn: shown.turn + 1 });
	}
	return <Banner key={shown.turn} incidentId={incidentId} initial={initial} />;
}

function Banner({ incidentId, initial }: Props) {
	const [current, setCurrent] = useState(initial);
	const { data, error } = useProgress<{
		progress: NotificationProgress | null;
	}>(
		`/manage/progress/incidents/${incidentId}`,
		2000,
		(body) => body.progress === null || body.progress.active === 0,
	);
	useEffect(() => {
		if (data?.progress) {
			setCurrent(data.progress);
		}
	}, [data]);
	const active = current.active > 0;
	const tone =
		!active && current.failed > 0 ? "major" : active ? "brand" : "operational";
	const box = active
		? "border-border bg-surface"
		: current.failed > 0
			? "border-major/40 bg-major/10"
			: "border-operational/40 bg-operational/10";
	return (
		<section
			role="status"
			className={`space-y-3 rounded-lg border px-4 py-3 ${box}`}
		>
			{active && <p className="text-sm">The queue sends the notifications.</p>}
			<p className="text-sm">
				Notifications complete: {current.done} of {current.total}.
			</p>
			<ProgressBar value={current.done} max={current.total} tone={tone} />
			{!active && current.failed === 0 && (
				<p className="text-sm">
					All notifications were sent. Sent: {current.sent}.
				</p>
			)}
			{!active && current.failed > 0 && (
				<p className="text-sm">
					Some notifications failed. Sent: {current.sent}. Failed:{" "}
					{current.failed}.
				</p>
			)}
			{current.fallback && (
				<p className="text-sm">
					The queue was not available. The server sent these notifications
					without the queue.
				</p>
			)}
			{error && (
				<p role="alert" className="text-sm">
					The page cannot read the progress. Reload the page.
				</p>
			)}
		</section>
	);
}
