import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ConfirmButton } from "@/components/manage/confirm-button";
import {
	ImpactSelect,
	ServicePicker,
	ServiceStatusSelect,
	StatusSelect,
	WindowFields,
} from "@/components/manage/incident-fields";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { buttonClass, Card, Field, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import {
	DRAFT_LABELS,
	DRAFT_STATE_LABELS,
	EVENT_STATUS_LABELS,
	hasRole,
	IMPACT_LABELS,
	SERVICE_STATUS_LABELS,
} from "@/lib/domain/status";
import type {
	AuthorRef,
	Incident,
	NotificationDraft,
	Service,
} from "@/lib/domain/types";
import { draftPath } from "@/lib/services/drafts";
import {
	approveDraftAction,
	discardDraftAction,
	saveDraftAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notification draft" };

interface Props {
	params: Promise<{ id: string }>;
	searchParams: Promise<FlashParams>;
}

const noteClass =
	"rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm";

function ReviewState({ draft }: { draft: NotificationDraft }) {
	if (draft.state === "pending") {
		return (
			<p className={noteClass}>
				This draft waits for review. When an editor approves it, the update is
				published on the status page and sent to subscribers.
			</p>
		);
	}
	return (
		<p className={noteClass}>
			{DRAFT_STATE_LABELS[draft.state]} by{" "}
			{(draft.reviewedBy as AuthorRef).name} ·{" "}
			<LocalTime iso={draft.reviewedAt as string} />
			{draft.state === "discarded" && ". Nothing was published or sent."}
		</p>
	);
}

function ReviewForm({
	draft,
	incident,
	catalog,
}: {
	draft: NotificationDraft;
	incident?: Incident;
	catalog: Service[];
}) {
	const { content } = draft;
	const isCreate = draft.action === "create";
	const isIncident = draft.kind === "incident";
	return (
		<Card
			title="Review the notification"
			description="Change what you need, then approve. Save keeps the draft for later."
		>
			<form action={saveDraftAction} className="space-y-5">
				<input type="hidden" name="id" value={draft.id} />
				{isCreate && (
					<Field label="Title" htmlFor="title">
						<input
							id="title"
							name="title"
							defaultValue={content.title}
							required
							maxLength={200}
							className={inputClass}
						/>
					</Field>
				)}
				<div className="grid gap-4 sm:grid-cols-2">
					<StatusSelect
						kind={draft.kind}
						value={content.status}
						keepLabel={
							isCreate
								? undefined
								: `Keep current status (${EVENT_STATUS_LABELS[(incident as Incident).status]})`
						}
					/>
					{isCreate && isIncident && <ImpactSelect value={content.impact} />}
				</div>
				{isCreate && !isIncident && (
					<WindowFields
						start={content.scheduledStart}
						end={content.scheduledEnd}
					/>
				)}
				<Field
					label="Message"
					htmlFor="message"
					hint="Subscribers receive this message. The status page shows it too."
				>
					<textarea
						id="message"
						name="message"
						defaultValue={content.message}
						required
						rows={6}
						className={inputClass}
					/>
				</Field>
				{isCreate && (
					<ServicePicker services={catalog} selected={content.serviceIds} />
				)}
				<ServiceStatusSelect
					value={content.serviceStatus}
					hint="Automatic follows the impact and the status. It restores services on resolution and starts maintenance mode when maintenance is in progress."
				/>
				<div className="flex flex-wrap gap-2">
					<SubmitButton
						formAction={saveDraftAction}
						className={buttonClass.secondary}
					>
						Save draft
					</SubmitButton>
					<SubmitButton
						formAction={approveDraftAction}
						className={buttonClass.primary}
					>
						Approve and send
					</SubmitButton>
				</div>
			</form>
		</Card>
	);
}

function Item({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<dt className="text-xs text-muted">{label}</dt>
			<dd className="mt-0.5">{children}</dd>
		</div>
	);
}

function DraftSummary({
	draft,
	catalog,
}: {
	draft: NotificationDraft;
	catalog: Service[];
}) {
	const { content } = draft;
	const affected = catalog.filter((service) =>
		content.serviceIds?.includes(service.id),
	);
	return (
		<Card title="Notification">
			<dl className="space-y-4 text-sm">
				{content.status && (
					<Item label="Status">{EVENT_STATUS_LABELS[content.status]}</Item>
				)}
				{content.impact && (
					<Item label="Impact">{IMPACT_LABELS[content.impact]}</Item>
				)}
				{content.scheduledStart && content.scheduledEnd && (
					<Item label="Window">
						<LocalTime iso={content.scheduledStart} /> to{" "}
						<LocalTime iso={content.scheduledEnd} />
					</Item>
				)}
				{affected.length > 0 && (
					<Item label="Affected services">
						{affected.map((service) => service.name).join(", ")}
					</Item>
				)}
				{content.serviceStatus && (
					<Item label="Set affected services to">
						{SERVICE_STATUS_LABELS[content.serviceStatus]}
					</Item>
				)}
				<Item label="Message">
					<p className="whitespace-pre-wrap">{content.message}</p>
				</Item>
			</dl>
		</Card>
	);
}

export default async function DraftPage({ params, searchParams }: Props) {
	const [{ id }, flash] = await Promise.all([params, searchParams]);
	const { member, services, app } = await requireMember(
		"viewer",
		draftPath(id),
	);
	const draft = await services.drafts.find(id);
	if (!draft) {
		notFound();
	}
	const [settings, catalog, incident] = await Promise.all([
		services.settings.get(),
		services.catalog.list(),
		draft.incidentId ? services.incidents.find(draft.incidentId) : undefined,
	]);
	const pending = draft.state === "pending";
	const canReview = pending && hasRole(member.role, "editor");
	const missing = draft.action === "update" && !incident;
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="drafts"
			title={draft.content.title ?? incident?.title ?? "Deleted incident"}
			flash={flash}
			health={app.store.health}
			actions={
				incident && (
					<Link
						href={`/manage/incidents/${incident.id}`}
						className={buttonClass.secondary}
					>
						View incident
					</Link>
				)
			}
		>
			<p className="text-sm text-muted">
				{DRAFT_LABELS[draft.action][draft.kind]} · Drafted by{" "}
				{draft.createdBy.name} · <LocalTime iso={draft.createdAt} />
			</p>
			<ReviewState draft={draft} />
			{missing && pending && (
				<p className="rounded-lg border border-major/40 bg-major/10 px-4 py-3 text-sm text-major">
					Somebody deleted the incident of this draft. You cannot approve the
					draft. Discard it.
				</p>
			)}
			{canReview && !missing ? (
				<ReviewForm draft={draft} incident={incident} catalog={catalog} />
			) : (
				<DraftSummary draft={draft} catalog={catalog} />
			)}
			{canReview && (
				<form action={discardDraftAction}>
					<input type="hidden" name="id" value={draft.id} />
					<ConfirmButton message="Discard this draft? Nothing is published or sent.">
						Discard draft
					</ConfirmButton>
				</form>
			)}
		</ManageShell>
	);
}
