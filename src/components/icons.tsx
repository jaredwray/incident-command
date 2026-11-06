import type { ServiceStatus } from "@/lib/domain/types";

interface IconProps {
	className?: string;
}

const base = {
	xmlns: "http://www.w3.org/2000/svg",
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

export function CheckIcon({ className }: IconProps) {
	return (
		<svg {...base} className={className} aria-hidden="true">
			<circle cx="12" cy="12" r="10" />
			<path d="m8 12 3 3 5-6" />
		</svg>
	);
}

export function AlertIcon({ className }: IconProps) {
	return (
		<svg {...base} className={className} aria-hidden="true">
			<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
			<path d="M12 9v4M12 17h.01" />
		</svg>
	);
}

export function OutageIcon({ className }: IconProps) {
	return (
		<svg {...base} className={className} aria-hidden="true">
			<circle cx="12" cy="12" r="10" />
			<path d="m15 9-6 6M9 9l6 6" />
		</svg>
	);
}

export function WrenchIcon({ className }: IconProps) {
	return (
		<svg {...base} className={className} aria-hidden="true">
			<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z" />
		</svg>
	);
}

export function ChevronDownIcon({ className }: IconProps) {
	return (
		<svg {...base} className={className} aria-hidden="true">
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

export function StatusIcon({
	status,
	className,
}: IconProps & { status: ServiceStatus }) {
	switch (status) {
		case "operational":
			return <CheckIcon className={className} />;
		case "under_maintenance":
			return <WrenchIcon className={className} />;
		case "major_outage":
			return <OutageIcon className={className} />;
		default:
			return <AlertIcon className={className} />;
	}
}
