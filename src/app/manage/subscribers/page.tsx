import type { Metadata } from "next";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	EmptyState,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { addSubscriberAction, deleteSubscriberAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscribers" };

export default async function SubscribersPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, actor, services, app } = await requireMember("admin");
	const [settings, subscribers] = await Promise.all([
		services.settings.get(),
		services.subscribers.list(actor),
	]);
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="subscribers"
			title="Subscribers"
			flash={flash}
			health={app.store.health}
		>
			{!app.notifier.emailEnabled && (
				<p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted">
					Email is not configured, so only webhooks are delivered and the public
					subscribe form is hidden. Set EMAIL_FROM with SendGrid or Amazon SES
					to enable email.
				</p>
			)}
			<Card
				title="Add a subscriber"
				description="Webhooks receive a JSON payload with Slack-compatible text and Discord-compatible content fields."
			>
				<form
					action={addSubscriberAction}
					className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end"
				>
					<Field label="Type" htmlFor="sub-type">
						<select
							id="sub-type"
							name="type"
							defaultValue="webhook"
							className={inputClass}
						>
							<option value="webhook">Webhook</option>
							<option value="email">Email</option>
						</select>
					</Field>
					<Field label="URL or email" htmlFor="sub-target">
						<input
							id="sub-target"
							name="target"
							required
							placeholder="https://hooks.slack.com/services/…"
							className={inputClass}
						/>
					</Field>
					<SubmitButton className={buttonClass.primary}>Add</SubmitButton>
				</form>
			</Card>
			<Card title={`Subscribers (${subscribers.length})`}>
				{subscribers.length === 0 ? (
					<EmptyState>No subscribers yet.</EmptyState>
				) : (
					<ul className="divide-y divide-border">
						{subscribers.map((subscriber) => (
							<li
								key={subscriber.id}
								className="flex flex-wrap items-center justify-between gap-3 py-3"
							>
								<div className="min-w-0">
									<p className="truncate font-medium">{subscriber.target}</p>
									<p className="text-xs text-muted">
										{subscriber.type === "email" ? "Email" : "Webhook"} ·{" "}
										{subscriber.confirmed
											? "Confirmed"
											: "Pending confirmation"}{" "}
										· Added <LocalTime iso={subscriber.createdAt} />
									</p>
								</div>
								<form action={deleteSubscriberAction}>
									<input type="hidden" name="id" value={subscriber.id} />
									<ConfirmButton message={`Remove ${subscriber.target}?`}>
										Remove
									</ConfirmButton>
								</form>
							</li>
						))}
					</ul>
				)}
			</Card>
		</ManageShell>
	);
}
