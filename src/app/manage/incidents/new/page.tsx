import type { Metadata } from "next";
import {
	ComponentPicker,
	ComponentStatusSelect,
	ImpactSelect,
	StatusSelect,
	WindowFields,
} from "@/components/manage/incident-fields";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	Checkbox,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { requireMember } from "@/lib/auth";
import type { IncidentKind } from "@/lib/domain/types";
import { createIncidentAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New incident" };

export default async function NewIncidentPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams & { kind?: string }>;
}) {
	const { kind: rawKind, ...flash } = await searchParams;
	const kind: IncidentKind =
		rawKind === "maintenance" ? "maintenance" : "incident";
	const { member, services, app } = await requireMember("editor");
	const [settings, components] = await Promise.all([
		services.settings.get(),
		services.components.list(),
	]);
	const isIncident = kind === "incident";
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="incidents"
			title={isIncident ? "Declare an incident" : "Schedule maintenance"}
			flash={flash}
			health={app.store.health}
		>
			<Card>
				<form action={createIncidentAction} className="space-y-5">
					<input type="hidden" name="kind" value={kind} />
					<Field
						label="Title"
						htmlFor="title"
						hint="Short and customer-facing, e.g. “Elevated API error rates”."
					>
						<input
							id="title"
							name="title"
							required
							maxLength={200}
							className={inputClass}
						/>
					</Field>
					<div className="grid gap-4 sm:grid-cols-2">
						<StatusSelect kind={kind} />
						{isIncident && <ImpactSelect />}
					</div>
					{!isIncident && <WindowFields />}
					<Field
						label="Message"
						htmlFor="message"
						hint="The first public update."
					>
						<textarea
							id="message"
							name="message"
							required
							rows={5}
							className={inputClass}
						/>
					</Field>
					<ComponentPicker components={components} />
					{isIncident && (
						<ComponentStatusSelect hint="Automatic derives the status from the impact." />
					)}
					<Checkbox name="notify" label="Notify subscribers" defaultChecked />
					<button type="submit" className={buttonClass.primary}>
						{isIncident ? "Declare incident" : "Schedule maintenance"}
					</button>
				</form>
			</Card>
		</ManageShell>
	);
}
