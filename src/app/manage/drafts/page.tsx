import type { Metadata } from "next";
import Link from "next/link";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { Card, EmptyState } from "@/components/manage/ui";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { DRAFT_LABELS, DRAFT_STATE_LABELS } from "@/lib/domain/status";
import type { NotificationDraft } from "@/lib/domain/types";
import type { Services } from "@/lib/services";
import { draftPath } from "@/lib/services/drafts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notification drafts" };

interface DraftItem {
	draft: NotificationDraft;
	title: string;
}

/** Adds a title to each draft: the new event title, or the title of the incident to update. */
async function withTitles(
	services: Services,
	drafts: NotificationDraft[],
): Promise<DraftItem[]> {
	return Promise.all(
		drafts.map(async (draft) => ({
			draft,
			title:
				draft.content.title ??
				(await services.incidents.find(draft.incidentId as string))?.title ??
				"Deleted incident",
		})),
	);
}

function DraftList({ items, empty }: { items: DraftItem[]; empty: string }) {
	if (items.length === 0) {
		return <EmptyState>{empty}</EmptyState>;
	}
	return (
		<ul className="divide-y divide-border">
			{items.map(({ draft, title }) => (
				<li
					key={draft.id}
					className="flex flex-wrap items-center justify-between gap-2 py-3"
				>
					<div className="min-w-0">
						<Link
							href={draftPath(draft.id)}
							className="font-medium break-words hover:underline"
						>
							{title}
						</Link>
						<p className="text-xs text-muted">
							{DRAFT_LABELS[draft.action][draft.kind]} · Drafted by{" "}
							{draft.createdBy.name} · <LocalTime iso={draft.createdAt} />
						</p>
					</div>
					<span className="text-xs text-muted">
						{DRAFT_STATE_LABELS[draft.state]}
						{draft.reviewedBy && ` by ${draft.reviewedBy.name}`}
					</span>
				</li>
			))}
		</ul>
	);
}

export default async function DraftsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const [settings, pending, reviewed] = await Promise.all([
		services.settings.get(),
		services.drafts.list({ pending: true }),
		services.drafts.list({ pending: false, limit: 50 }),
	]);
	const [pendingItems, reviewedItems] = await Promise.all([
		withTitles(services, pending),
		withTitles(services, reviewed),
	]);
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="drafts"
			title="Notification drafts"
			flash={flash}
			health={app.store.health}
		>
			<Card
				title="Waiting for review"
				description="Agents write drafts with the draft_notification MCP tool. Nothing is published or sent until an editor approves a draft."
			>
				<DraftList items={pendingItems} empty="No drafts wait for review." />
			</Card>
			<Card title="Reviewed" description="The 50 most recent.">
				<DraftList items={reviewedItems} empty="No reviewed drafts yet." />
			</Card>
		</ManageShell>
	);
}
