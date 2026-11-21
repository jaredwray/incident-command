import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
	approveDraftAction,
	approveDraftWithProgressAction,
	discardDraftAction,
	saveDraftAction,
} from "@/app/manage/actions";
import { ConfirmButton } from "@/components/manage/confirm-button";
import {
	AddServices,
	ImpactSelect,
	ServicePicker,
	ServiceRegionEditor,
	ServiceStatusList,
	ServiceStatusSelect,
	StatusSelect,
	TitleField,
	WindowFields,
} from "@/components/manage/incident-fields";
import { SendButton } from "@/components/manage/send-button";
import { type FlashParams, ManagePage } from "@/components/manage/shell";
import { buttonClass, Card, Field, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { boundServiceRegions, regionNameFor } from "@/lib/domain/regions";
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
	Region,
	Service,
	ServiceRegions,
} from "@/lib/domain/types";
import { draftPath, regionsInDraft } from "@/lib/services/drafts";

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

/** Regions to show for services that the incident already affects. */
function reviewRegions(
	incident: Incident,
	content: NotificationDraft["content"],
): ServiceRegions[] {
	const map = new Map(
		boundServiceRegions(incident).map((entry) => [
			entry.serviceId,
			entry.regionIds,
		]),
	);
	for (const entry of regionsInDraft(content) ?? []) {
		map.set(entry.serviceId, entry.regionIds);
	}
	return [...map.entries()].map(([serviceId, regionIds]) => ({
		serviceId,
		regionIds,
	}));
}

function ReviewForm({
	draft,
	incident,
	catalog,
	regions,
	modal,
}: {
	draft: NotificationDraft;
	incident?: Incident;
	catalog: Service[];
	regions: readonly Region[];
	modal: boolean;
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
				<TitleField
					value={isCreate ? content.title : (content.title ?? incident?.title)}
					hint={
						isCreate
							? "Short and customer-facing, e.g. “Elevated API error rates”."
							: "This post records the title. The incident shows the title of the latest post."
					}
				/>
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
					{isIncident && (
						<ImpactSelect
							value={
								isCreate ? content.impact : (content.impact ?? incident?.impact)
							}
							hint={
								isCreate
									? undefined
									: "This post records the impact. A new impact does not change the status of the affected services. Set their status below."
							}
						/>
					)}
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
					<ServicePicker
						services={catalog}
						selected={content.serviceIds}
						withStatus
						statuses={content.serviceStatuses}
						regions={regions}
						serviceRegions={regionsInDraft(content)}
					/>
				)}
				<ServiceStatusSelect
					value={content.serviceStatus}
					hint="Automatic follows the impact and the status. It restores services on resolution and starts maintenance mode when maintenance is in progress."
				/>
				{!isCreate && (
					<>
						<ServiceStatusList
							services={catalog.filter((service) =>
								(incident as Incident).serviceIds.includes(service.id),
							)}
							values={content.serviceStatuses}
						/>
						{(incident as Incident).serviceIds.map((serviceId) => (
							<input
								key={serviceId}
								type="hidden"
								name="boundServiceIds"
								value={serviceId}
							/>
						))}
						<ServiceRegionEditor
							services={catalog.filter((service) =>
								(incident as Incident).serviceIds.includes(service.id),
							)}
							regions={regions}
							values={reviewRegions(incident as Incident, content)}
						/>
						<AddServices
							catalog={catalog}
							affectedIds={(incident as Incident).serviceIds}
							selected={content.serviceIds}
							statuses={content.serviceStatuses}
							regions={regions}
							serviceRegions={regionsInDraft(content)}
						/>
					</>
				)}
				<div className="flex flex-wrap gap-2">
					<SubmitButton
						formAction={saveDraftAction}
						className={buttonClass.secondary}
					>
						Save draft
					</SubmitButton>
					<SendButton
						modal={modal}
						progressAction={approveDraftWithProgressAction}
						formAction={approveDraftAction}
						className={buttonClass.primary}
					>
						Approve and send
					</SendButton>
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
	regions,
}: {
	draft: NotificationDraft;
	catalog: Service[];
	regions: readonly Region[];
}) {
	const { content } = draft;
	const affected = catalog.filter((service) =>
		content.serviceIds?.includes(service.id),
	);
	const own = catalog.flatMap((service) => {
		const entry = content.serviceStatuses?.find(
			({ serviceId }) => serviceId === service.id,
		);
		return entry ? [{ service, status: entry.status }] : [];
	});
	const draftRegions = regionsInDraft(content);
	const regionServiceIds = [
		...new Set([
			...(content.serviceIds ?? []),
			...(draftRegions ?? []).map((entry) => entry.serviceId),
		]),
	];
	const regionLabel =
		draftRegions && regionServiceIds.length > 0
			? regionNameFor(
					{
						serviceIds: regionServiceIds,
						serviceRegions: draftRegions,
					},
					regions,
				)
			: undefined;
	return (
		<Card title="Notification">
			<dl className="space-y-4 text-sm">
				{content.title && <Item label="Incident Title">{content.title}</Item>}
				{content.status && (
					<Item label="Status">{EVENT_STATUS_LABELS[content.status]}</Item>
				)}
				{content.impact && (
					<Item label="Impact">{IMPACT_LABELS[content.impact]}</Item>
				)}
				{regionLabel && <Item label="Regions">{regionLabel}</Item>}
				{content.scheduledStart && content.scheduledEnd && (
					<Item label="Window">
						<LocalTime iso={content.scheduledStart} /> to{" "}
						<LocalTime iso={content.scheduledEnd} />
					</Item>
				)}
				{affected.length > 0 && (
					<Item
						label={
							draft.action === "update"
								? "Services to add"
								: "Affected services"
						}
					>
						{affected.map((service) => service.name).join(", ")}
					</Item>
				)}
				{content.serviceStatus && (
					<Item label="Set affected services to">
						{SERVICE_STATUS_LABELS[content.serviceStatus]}
					</Item>
				)}
				{own.length > 0 && (
					<Item label="Status of each service">
						<ul>
							{own.map(({ service, status }) => (
								<li key={service.id}>
									{service.name}: {SERVICE_STATUS_LABELS[status]}
								</li>
							))}
						</ul>
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
	const [catalog, incident, regions] = await Promise.all([
		services.catalog.list(),
		draft.incidentId ? services.incidents.find(draft.incidentId) : undefined,
		services.regions.list(),
	]);
	const pending = draft.state === "pending";
	const canReview = pending && hasRole(member.role, "editor");
	const missing = draft.action === "update" && !incident;
	const queueProvider = canReview
		? await services.notificationQueue.provider()
		: undefined;
	return (
		<ManagePage
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
				<ReviewForm
					draft={draft}
					incident={incident}
					catalog={catalog}
					regions={regions}
					modal={queueProvider === undefined}
				/>
			) : (
				<DraftSummary draft={draft} catalog={catalog} regions={regions} />
			)}
			{canReview && (
				<form action={discardDraftAction}>
					<input type="hidden" name="id" value={draft.id} />
					<ConfirmButton message="Discard this draft? Nothing is published or sent.">
						Discard draft
					</ConfirmButton>
				</form>
			)}
		</ManagePage>
	);
}
