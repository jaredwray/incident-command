import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/manage/confirm-button";
import {
	ImpactSelect,
	ServicePicker,
	ServiceStatusSelect,
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
import { EventStatusBadge, ImpactBadge } from "@/components/status/badges";
import { Timeline } from "@/components/status/timeline";
import { SubmitButton } from "@/components/submit-button";
import { requireMember } from "@/lib/auth";
import { hasRole } from "@/lib/domain/status";
import {
	deleteIncidentAction,
	editIncidentAction,
	postIncidentUpdateAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incident" };

interface Props {
	params: Promise<{ id: string }>;
	searchParams: Promise<FlashParams>;
}

export default async function ManageIncidentPage({
	params,
	searchParams,
}: Props) {
	const [{ id }, flash] = await Promise.all([params, searchParams]);
	const { member, services, app } = await requireMember();
	const incident = await services.incidents.find(id);
	if (!incident) {
		notFound();
	}
	const [settings, catalog] = await Promise.all([
		services.settings.get(),
		services.catalog.list(),
	]);
	const canEdit = hasRole(member.role, "editor");
	const isIncident = incident.kind === "incident";
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="incidents"
			title={incident.title}
			flash={flash}
			health={app.store.health}
			actions={
				<Link
					href={`/incidents/${incident.id}`}
					className={buttonClass.secondary}
				>
					View public page
				</Link>
			}
		>
			<div className="flex flex-wrap gap-2">
				<EventStatusBadge
					kind={incident.kind}
					impact={incident.impact}
					status={incident.status}
				/>
				{isIncident && <ImpactBadge impact={incident.impact} />}
			</div>
			<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
				<div className="space-y-6">
					{canEdit && (
						<Card title="Post an update">
							<form action={postIncidentUpdateAction} className="space-y-4">
								<input type="hidden" name="id" value={incident.id} />
								<StatusSelect kind={incident.kind} value={incident.status} />
								<Field label="Message" htmlFor="message">
									<textarea
										id="message"
										name="message"
										required
										rows={4}
										className={inputClass}
									/>
								</Field>
								<ServiceStatusSelect hint="Automatic restores services when resolving and starts maintenance mode when in progress." />
								<Checkbox
									name="notify"
									label="Notify subscribers"
									defaultChecked
								/>
								<SubmitButton className={buttonClass.primary}>
									Post update
								</SubmitButton>
							</form>
						</Card>
					)}
					<Card title="Timeline">
						<Timeline incident={incident} showAuthors />
					</Card>
				</div>
				{canEdit && (
					<div className="space-y-6">
						<Card title="Details">
							<form action={editIncidentAction} className="space-y-4">
								<input type="hidden" name="id" value={incident.id} />
								<Field label="Title" htmlFor="edit-title">
									<input
										id="edit-title"
										name="title"
										defaultValue={incident.title}
										required
										className={inputClass}
									/>
								</Field>
								{isIncident ? (
									<ImpactSelect value={incident.impact} id="edit-impact" />
								) : (
									<WindowFields
										start={incident.scheduledStart}
										end={incident.scheduledEnd}
									/>
								)}
								<ServicePicker
									services={catalog}
									selected={incident.serviceIds}
								/>
								<SubmitButton className={buttonClass.secondary}>
									Save details
								</SubmitButton>
							</form>
						</Card>
						<form action={deleteIncidentAction}>
							<input type="hidden" name="id" value={incident.id} />
							<ConfirmButton message="Delete this incident permanently? This cannot be undone.">
								Delete incident
							</ConfirmButton>
						</form>
					</div>
				)}
			</div>
		</ManageShell>
	);
}
