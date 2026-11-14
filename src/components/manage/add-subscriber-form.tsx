"use client";

import { useState } from "react";
import { addSubscriberAction } from "@/app/manage/actions";
import { SubmitButton } from "@/components/submit-button";
import type { SubscriberType } from "@/lib/domain/types";
import { buttonClass, Field, inputClass } from "./ui";

const TYPES: { value: SubscriberType; title: string; detail: string }[] = [
	{
		value: "webhook",
		title: "Webhook",
		detail: "Send a JSON payload to a URL.",
	},
	{ value: "email", title: "Email", detail: "Send updates to an address." },
	{
		value: "sms",
		title: "Text message",
		detail: "Send a short text to a phone.",
	},
];

const TARGETS: Record<
	SubscriberType,
	{
		label: string;
		inputType: "url" | "email" | "tel";
		placeholder: string;
		autoComplete: "url" | "email" | "tel";
		hint: string;
	}
> = {
	webhook: {
		label: "Webhook URL",
		inputType: "url",
		placeholder: "https://hooks.slack.com/services/…",
		autoComplete: "url",
		hint: "The payload has Slack-compatible text and Discord-compatible content.",
	},
	email: {
		label: "Email address",
		inputType: "email",
		placeholder: "ops@example.com",
		autoComplete: "email",
		hint: "The address is confirmed at once. No confirmation mail is sent.",
	},
	sms: {
		label: "Phone number",
		inputType: "tel",
		placeholder: "+15551234567",
		autoComplete: "tel",
		hint: "Use E.164 format with the country code. Get consent before you add a number.",
	},
};

const cardClass = "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm";
const selectedClass = "border-brand bg-brand/10";
const idleClass = "border-border bg-bg hover:bg-surface-muted";
const disabledClass = "cursor-not-allowed border-border bg-bg opacity-60";

/**
 * Adds a webhook, email or phone subscriber. The destination field follows
 * the type. A type whose channel cannot send is not available.
 */
export function AddSubscriberForm({
	available,
}: {
	available: Record<SubscriberType, boolean>;
}) {
	const [type, setType] = useState<SubscriberType>("webhook");
	const target = TARGETS[type];
	return (
		<form action={addSubscriberAction} className="space-y-4">
			<fieldset className="space-y-1.5">
				<legend className="text-sm font-medium">Type</legend>
				<div className="grid gap-3 sm:grid-cols-3">
					{TYPES.map((option) => {
						const disabled = !available[option.value];
						const selected = type === option.value;
						return (
							<label
								key={option.value}
								className={`${cardClass} ${
									disabled
										? disabledClass
										: selected
											? selectedClass
											: `${idleClass} cursor-pointer`
								}`}
							>
								<input
									type="radio"
									name="type"
									value={option.value}
									checked={selected}
									disabled={disabled}
									onChange={() => setType(option.value)}
									className="mt-0.5 size-4 shrink-0 accent-brand"
								/>
								<span className="min-w-0 flex-1">
									<span className="flex flex-wrap items-baseline gap-x-2">
										<span className="font-medium">{option.title}</span>
										{disabled && (
											<span className="text-xs text-muted">Not available</span>
										)}
									</span>
									<span className="block text-xs text-muted">
										{option.detail}
									</span>
								</span>
							</label>
						);
					})}
				</div>
			</fieldset>
			<Field
				key={type}
				label={target.label}
				htmlFor="sub-target"
				hint={target.hint}
			>
				<div className="flex flex-col gap-3 sm:flex-row">
					<input
						id="sub-target"
						name="target"
						type={target.inputType}
						required
						placeholder={target.placeholder}
						autoComplete={target.autoComplete}
						className={inputClass}
					/>
					<SubmitButton className={`${buttonClass.primary} sm:shrink-0`}>
						Add
					</SubmitButton>
				</div>
			</Field>
		</form>
	);
}
