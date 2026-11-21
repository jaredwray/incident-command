import type { Metadata } from "next";
import {
	createIncidentAction,
	createIncidentWithProgressAction,
} from "@/app/manage/actions";
import {
	ImpactSelect,
	ServicePicker,
	ServiceStatusSelect,
	StatusSelect,
	TitleField,
	WindowFields,
} from "@/components/manage/incident-fields";
import { SendButton } from "@/components/manage/send-button";
import { type FlashParams, ManagePage } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	Checkbox,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { requireMember } from "@/lib/auth";
import type { IncidentKind } from "@/lib/domain/types";

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
	const { services, app } = await requireMember("editor");
	const queueProvider = await services.notificationQueue.provider();
	const [catalog, regions] = await Promise.all([
		services.catalog.list(),
		services.regions.list(),
	]);
	const isIncident = kind === "incident";
	return (
		<ManagePage
			title={isIncident ? "Declare an incident" : "Schedule maintenance"}
			flash={flash}
			health={app.store.health}
		>
			<Card>
				<form action={createIncidentAction} className="space-y-5">
					<input type="hidden" name="kind" value={kind} />
					<TitleField hint="Short and customer-facing, e.g. “Elevated API error rates”." />
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
					<ServicePicker
						services={catalog}
						withStatus={isIncident}
						regions={regions}
					/>
					{isIncident && (
						<ServiceStatusSelect hint="Automatic derives the status from the impact." />
					)}
					<Checkbox name="notify" label="Notify subscribers" defaultChecked />
					<SendButton
						modal={!queueProvider}
						progressAction={createIncidentWithProgressAction}
						formAction={createIncidentAction}
						className={buttonClass.primary}
					>
						{isIncident ? "Declare incident" : "Schedule maintenance"}
					</SendButton>
				</form>
			</Card>
		</ManagePage>
	);
}
