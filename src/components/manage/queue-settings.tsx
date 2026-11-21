"use client";

import { useState } from "react";
import { updateNotificationQueueAction } from "@/app/manage/actions";
import { SubmitButton } from "@/components/submit-button";
import {
	type PublicNotificationQueue,
	QUEUE_PROVIDER_IDS,
	type QueueProviderId,
} from "@/lib/domain/types";
import { QUEUE_PROVIDERS } from "@/lib/notifications/queue-catalog";
import { buttonClass, Card, Field, inputClass } from "./ui";

const OPTIONS: { id: "none" | QueueProviderId; label: string; hint: string }[] =
	[
		{
			id: "none",
			label: "No queue",
			hint: "A window shows the status of each notification.",
		},
		...QUEUE_PROVIDER_IDS.map((id) => ({
			id,
			label: QUEUE_PROVIDERS[id].label,
			hint: QUEUE_PROVIDERS[id].hint,
		})),
	];

/** The queue choice. An admin selects one provider, or no queue. */
export function QueueSettingsCard({
	queue,
	canStoreSecrets,
}: {
	queue: PublicNotificationQueue;
	canStoreSecrets: boolean;
}) {
	const [provider, setProvider] = useState<"none" | QueueProviderId>(
		queue.provider ?? "none",
	);
	const definition =
		provider === "none" ? undefined : QUEUE_PROVIDERS[provider];
	return (
		<Card
			title="Queue"
			description="With a queue, the server sends subscriber notifications in the background. Select one provider, or no queue."
		>
			<form action={updateNotificationQueueAction} className="space-y-4">
				<input type="hidden" name="revision" value={queue.revision} />
				<fieldset className="space-y-3">
					<legend className="text-sm font-medium">Provider</legend>
					{OPTIONS.map((option) => (
						<label key={option.id} className="flex items-start gap-2 text-sm">
							<input
								type="radio"
								name="provider"
								value={option.id}
								checked={provider === option.id}
								onChange={() => setProvider(option.id)}
								className="mt-1"
							/>
							<span>
								<span className="font-medium">{option.label}</span>
								<span className="mt-0.5 block text-muted">{option.hint}</span>
							</span>
						</label>
					))}
				</fieldset>
				{definition && (
					<Field
						label="Connection URI"
						htmlFor="queue-uri"
						hint={
							queue.hasUri && provider === queue.provider
								? "Saved. Leave empty to keep it."
								: `Leave empty to use ${definition.uri.default}.`
						}
					>
						<input
							id="queue-uri"
							name="uri"
							type="password"
							autoComplete="off"
							disabled={!canStoreSecrets}
							placeholder={definition.uri.default}
							className={inputClass}
						/>
					</Field>
				)}
				{!canStoreSecrets && definition && (
					<p className="text-xs text-muted">
						Set ENCRYPTION_KEY on the server to save credentials.
					</p>
				)}
				<SubmitButton className={buttonClass.primary}>Save queue</SubmitButton>
			</form>
		</Card>
	);
}
