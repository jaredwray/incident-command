"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

const local = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	timeZoneName: "short",
});

/**
 * Renders a timestamp in UTC on the server and switches to the viewer's
 * local time zone once hydrated.
 */
export function LocalTime({
	iso,
	className,
}: {
	iso: string;
	className?: string;
}) {
	const [text, setText] = useState(() => formatDateTime(iso));
	useEffect(() => {
		setText(local.format(new Date(iso)));
	}, [iso]);
	return (
		<time dateTime={iso} className={className} suppressHydrationWarning>
			{text}
		</time>
	);
}
