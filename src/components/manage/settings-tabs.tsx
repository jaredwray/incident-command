import Link from "next/link";

export type SettingsSection = "general" | "branding" | "notifications";

export const SETTINGS_SECTIONS: {
	key: SettingsSection;
	label: string;
	href: string;
}[] = [
	{ key: "general", label: "General", href: "/manage/settings" },
	{ key: "branding", label: "Branding", href: "/manage/settings/branding" },
	{
		key: "notifications",
		label: "Notifications",
		href: "/manage/settings/notifications",
	},
];

/** The section links at the top of each settings page. */
export function SettingsTabs({ active }: { active: SettingsSection }) {
	return (
		<nav
			aria-label="Settings sections"
			className="flex gap-1 overflow-x-auto border-b border-border"
		>
			{SETTINGS_SECTIONS.map((section) => (
				<Link
					key={section.key}
					href={section.href}
					aria-current={section.key === active ? "page" : undefined}
					className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
						section.key === active
							? "border-brand font-medium text-fg"
							: "border-transparent text-muted hover:text-fg"
					}`}
				>
					{section.label}
				</Link>
			))}
		</nav>
	);
}
