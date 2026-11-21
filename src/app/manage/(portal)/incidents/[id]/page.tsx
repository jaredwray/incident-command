import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	editIncidentAction,
	postIncidentUpdateAction,
	postIncidentUpdateWithProgressAction,
} from "@/app/manage/actions";
import { DeleteIncidentDialog } from "@/components/manage/delete-incident-dialog";
import { DraftList } from "@/components/manage/draft-list";
import {
	AddServices,
	ImpactSelect,
	ServiceRegionEditor,
	ServiceStatusList,
	ServiceStatusSelect,
	StatusSelect,
	TitleField,
	WindowFields,
} from "@/components/manage/incident-fields";
import {
	type IncidentTab,
	IncidentTabs,
	incidentTab,
} from "@/components/manage/incident-tabs";
import { PostList } from "@/components/manage/post-list";
import { SendButton } from "@/components/manage/send-button";
import { SendProgressBanner } from "@/components/manage/send-progress-banner";
import { type FlashParams, ManagePage } from "@/components/manage/shell";
import {
	ButtonLink,
	buttonClass,
	Card,
	Checkbox,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { EventStatusBadge, ImpactBadge } from "@/components/status/badges";
import { StatusTimeline } from "@/components/status/status-timeline";
import { Timeline } from "@/components/status/timeline";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { boundServiceRegions, regionNameFor } from "@/lib/domain/regions";
import { hasRole, isDeletedIncident } from "@/lib/domain/status";
import type {
	Incident,
	IncidentDeletion,
	NotificationDraft,
	NotificationProgress,
	Region,
	Service,
} from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incident" };

interface IncidentQuery extends FlashParams {
	tab?: string;
	post?: string;
}

interface Props {
	params: Promise<{ id: string }>;
	searchParams: Promise<IncidentQuery>;
}

/** The number of posts on the dashboard. The posts tab shows every post. */
const LATEST_POSTS = 5;

/** The path of an incident page. Set formOpen to open the post form. */
function incidentHref(id: string, tab: IncidentTab, formOpen = false): string {
	const path = `/manage/incidents/${id}`;
	if (tab === "posts") {
		return formOpen ? `${path}?tab=posts&post=1` : `${path}?tab=posts`;
	}
	return formOpen ? `${path}?post=1` : path;
}

function PostForm({
	incident,
	affected,
	catalog,
	regions,
	tab,
	modal,
}: {
	incident: Incident;
	affected: Service[];
	catalog: Service[];
	regions: readonly Region[];
	tab: IncidentTab;
	modal: boolean;
}) {
	return (
		<form
			action={postIncidentUpdateAction}
			className="mb-6 space-y-4 border-b border-border pb-6"
		>
			<input type="hidden" name="id" value={incident.id} />
			{tab === "posts" && <input type="hidden" name="tab" value="posts" />}
			<TitleField
				value={incident.title}
				hint="This post records the title. The incident shows the title of the latest post."
			/>
			<div className="grid gap-4 sm:grid-cols-2">
				<StatusSelect kind={incident.kind} value={incident.status} />
				{incident.kind === "incident" && (
					<ImpactSelect
						value={incident.impact}
						hint="This post records the impact. A new impact does not change the status of the affected services. Set their status below."
					/>
				)}
			</div>
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
			<ServiceStatusList services={affected} />
			<AddServices
				catalog={catalog}
				affectedIds={incident.serviceIds}
				regions={regions}
			/>
			<Checkbox name="notify" label="Notify subscribers" defaultChecked />
			<div className="flex flex-wrap gap-2">
				<SendButton
					modal={modal}
					progressAction={postIncidentUpdateWithProgressAction}
					formAction={postIncidentUpdateAction}
					className={buttonClass.primary}
				>
					Post update
				</SendButton>
				<Link
					href={incidentHref(incident.id, tab)}
					className={buttonClass.secondary}
				>
					Cancel
				</Link>
			</div>
		</form>
	);
}

function PostsCard({
	incident,
	affected,
	catalog,
	regions,
	canEdit,
	showForm,
	reviewed,
	tab,
	limit,
	modal,
}: {
	incident: Incident;
	affected: Service[];
	catalog: Service[];
	regions: readonly Region[];
	canEdit: boolean;
	showForm: boolean;
	reviewed: NotificationDraft[];
	tab: IncidentTab;
	limit?: number;
	modal: boolean;
}) {
	return (
		<Card
			title="Posts"
			actions={
				canEdit &&
				!showForm && (
					<ButtonLink href={incidentHref(incident.id, tab, true)}>
						Create a post
					</ButtonLink>
				)
			}
		>
			{showForm && (
				<PostForm
					incident={incident}
					affected={affected}
					catalog={catalog}
					regions={regions}
					tab={tab}
					modal={modal}
				/>
			)}
			<PostList incident={incident} drafts={reviewed} limit={limit} />
		</Card>
	);
}

const DELETE_EFFECTS = [
	"The status page, the history, the RSS feed, the API, and the agents do not show the incident.",
	"A link to the public page of the incident shows a not found page.",
	"Subscribers get no message about the deletion. The product cannot undo a message that it sent before.",
	"The affected services keep their current status. Change a wrong status on the Services page.",
	"Nobody can add a post, change the incident, or approve a draft for it.",
	"The Overview page does not count the incident.",
	"You cannot restore the incident from the portal.",
];

function DeleteIncidentBanner({ incidentId }: { incidentId: string }) {
	return (
		<section
			aria-labelledby="delete-incident-title"
			className="rounded-card border-2 border-major bg-major/10 p-6"
		>
			<h2
				id="delete-incident-title"
				className="text-lg font-semibold text-major"
			>
				Delete this incident
			</h2>
			<p className="mt-2 font-medium text-major">
				Be very careful. Delete an incident only when customers must not see it.
			</p>
			<p className="mt-3 text-sm">A deletion has these effects:</p>
			<ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
				{DELETE_EFFECTS.map((effect) => (
					<li key={effect}>{effect}</li>
				))}
			</ul>
			<p className="mt-3 text-sm">
				The portal keeps the incident. The record shows who deleted it and why.
			</p>
			<div className="mt-4">
				<DeleteIncidentDialog incidentId={incidentId} />
			</div>
		</section>
	);
}

function DeletionRecord({
	incident,
}: {
	incident: Incident & IncidentDeletion;
}) {
	return (
		<section
			aria-labelledby="deletion-record-title"
			className="rounded-card border border-major/40 bg-major/10 px-5 py-4"
		>
			<h2 id="deletion-record-title" className="font-semibold text-major">
				Deleted from the public view
			</h2>
			<p className="mt-2 text-sm">
				{incident.deletedBy.name} deleted this incident on{" "}
				<LocalTime iso={incident.deletedAt} />.
			</p>
			<p className="mt-2 text-sm break-words whitespace-pre-wrap">
				Reason: {incident.deletedReason}
			</p>
		</section>
	);
}

function IncidentBody({
	tab,
	incident,
	affected,
	catalog,
	regions,
	canEdit,
	showForm,
	pending,
	reviewed,
	modal,
}: {
	tab: IncidentTab;
	incident: Incident;
	affected: Service[];
	catalog: Service[];
	regions: readonly Region[];
	canEdit: boolean;
	showForm: boolean;
	pending: NotificationDraft[];
	reviewed: NotificationDraft[];
	modal: boolean;
}) {
	return (
		<div className="space-y-6">
			{tab === "dashboard" && (
				<PostsCard
					incident={incident}
					affected={affected}
					catalog={catalog}
					regions={regions}
					canEdit={canEdit}
					showForm={showForm}
					reviewed={reviewed}
					tab="dashboard"
					limit={LATEST_POSTS}
					modal={modal}
				/>
			)}
			{tab === "dashboard" && pending.length > 0 && (
				<Card title="Drafts" description="These drafts wait for review.">
					<DraftList
						items={pending.map((draft) => ({
							draft,
							title: draft.content.message,
						}))}
					/>
				</Card>
			)}
			{tab === "timeline" && (
				<Card title="Timeline">
					<Timeline incident={incident} showAuthors />
				</Card>
			)}
			{tab === "posts" && (
				<PostsCard
					incident={incident}
					affected={affected}
					catalog={catalog}
					regions={regions}
					canEdit={canEdit}
					showForm={showForm}
					reviewed={reviewed}
					tab="posts"
					modal={modal}
				/>
			)}
		</div>
	);
}

export default async function ManageIncidentPage({
	params,
	searchParams,
}: Props) {
	const [{ id }, query] = await Promise.all([params, searchParams]);
	const { member, actor, services, app } = await requireMember();
	const incident = await services.incidents.find(id, { includeDeleted: true });
	if (!incident) {
		notFound();
	}
	const tab = incidentTab(query.tab);
	const deleted = isDeletedIncident(incident);
	const canEdit = hasRole(member.role, "editor") && !deleted;
	const [catalog, regions, timeline, pending, reviewed] = await Promise.all([
		services.catalog.list(),
		services.regions.list(),
		services.status.incidentTimeline(incident),
		services.drafts.list({ pending: true, incidentId: incident.id }),
		services.drafts.list({ pending: false, incidentId: incident.id }),
	]);
	const affected = incident.serviceIds.map((id) => {
		const service = catalog.find((item) => item.id === id);
		return (
			service ?? {
				id,
				name: id,
				status: "operational" as const,
				order: 0,
				hidden: true,
				createdAt: incident.createdAt,
				updatedAt: incident.updatedAt,
			}
		);
	});
	const isIncident = incident.kind === "incident";
	const regionName = regionNameFor(incident, regions);
	const showForm =
		(tab === "dashboard" || tab === "posts") && query.post === "1" && canEdit;
	const queueProvider = canEdit
		? await services.notificationQueue.provider()
		: undefined;
	const progress: NotificationProgress | undefined = canEdit
		? await services.notificationJobs.incidentProgress(actor, incident.id)
		: undefined;
	return (
		<ManagePage
			title={incident.title}
			flash={query}
			health={app.store.health}
			actions={
				!deleted && (
					<Link
						href={`/incidents/${incident.id}`}
						className={buttonClass.secondary}
					>
						View public page
					</Link>
				)
			}
		>
			<div className="flex flex-wrap gap-2">
				<EventStatusBadge
					kind={incident.kind}
					impact={incident.impact}
					status={incident.status}
				/>
				{isIncident && <ImpactBadge impact={incident.impact} />}
				{regionName && <span className="text-sm text-muted">{regionName}</span>}
			</div>
			{deleted && <DeletionRecord incident={incident} />}
			<IncidentTabs id={incident.id} active={tab} />
			{tab === "dashboard" && progress && (
				<SendProgressBanner incidentId={incident.id} initial={progress} />
			)}
			{tab === "dashboard" && timeline.services.length > 0 && (
				<StatusTimeline {...timeline} />
			)}
			<div
				className={
					canEdit && tab === "dashboard"
						? "grid gap-6 lg:grid-cols-[1fr_320px]"
						: undefined
				}
			>
				<IncidentBody
					tab={tab}
					incident={incident}
					affected={affected}
					catalog={catalog}
					regions={regions}
					canEdit={canEdit}
					showForm={showForm}
					pending={pending}
					reviewed={reviewed}
					modal={canEdit && queueProvider === undefined}
				/>
				{tab === "dashboard" && canEdit && (
					<div className="space-y-6">
						{(!isIncident || (regions.length > 0 && affected.length > 0)) && (
							<Card title={isIncident ? "Regions" : "Maintenance window"}>
								<form action={editIncidentAction} className="space-y-4">
									<input type="hidden" name="id" value={incident.id} />
									{!isIncident && (
										<WindowFields
											start={incident.scheduledStart}
											end={incident.scheduledEnd}
										/>
									)}
									<ServiceRegionEditor
										services={affected}
										regions={regions}
										values={boundServiceRegions(incident)}
									/>
									<SubmitButton className={buttonClass.secondary}>
										{isIncident ? "Save regions" : "Save window"}
									</SubmitButton>
								</form>
							</Card>
						)}
					</div>
				)}
			</div>
			{tab === "dashboard" && canEdit && (
				<DeleteIncidentBanner incidentId={incident.id} />
			)}
		</ManagePage>
	);
}
