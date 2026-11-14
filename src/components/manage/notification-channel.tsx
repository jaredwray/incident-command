import {
	addNotificationProviderAction,
	moveNotificationProviderAction,
	removeNotificationProviderAction,
	updateNotificationChannelAction,
	updateNotificationProviderAction,
} from "@/app/manage/actions";
import { SubmitButton } from "@/components/submit-button";
import {
	DELIVERY_STRATEGIES,
	type PublicNotificationChannel,
	type PublicNotificationProvider,
} from "@/lib/domain/types";
import {
	CHANNELS,
	type ChannelDefinition,
	PROVIDERS,
	type ProviderDefinition,
	STRATEGIES,
} from "@/lib/notifications/catalog";
import { ConfirmButton } from "./confirm-button";
import {
	buttonClass,
	Card,
	Checkbox,
	EmptyState,
	Field,
	inputClass,
} from "./ui";

const pill =
	"inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

function ChannelStatus({ channel }: { channel: PublicNotificationChannel }) {
	if (!channel.enabled) {
		return <span className={`${pill} border-border text-muted`}>Off</span>;
	}
	return channel.available ? (
		<span className={`${pill} border-operational/40 bg-operational/10`}>
			On
		</span>
	) : (
		<span className={`${pill} border-degraded/40 bg-degraded/10`}>
			Not ready
		</span>
	);
}

/** The settings fields of a provider, for the add form and the edit form. */
function ProviderFields({
	idPrefix,
	channel,
	definition,
	provider,
	canStoreSecrets,
}: {
	idPrefix: string;
	channel: ChannelDefinition;
	definition: ProviderDefinition;
	provider?: PublicNotificationProvider;
	canStoreSecrets: boolean;
}) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<Field label="Name" htmlFor={`${idPrefix}-name`}>
				<input
					id={`${idPrefix}-name`}
					name="name"
					required
					maxLength={80}
					defaultValue={provider?.name ?? definition.label}
					className={inputClass}
				/>
			</Field>
			{channel.sender && (
				<Field
					label={channel.sender.label}
					htmlFor={`${idPrefix}-from`}
					hint="Optional. Leave empty to use the sender of the channel."
				>
					<input
						id={`${idPrefix}-from`}
						name="from"
						maxLength={200}
						defaultValue={provider?.from}
						placeholder={channel.sender.placeholder}
						className={inputClass}
					/>
				</Field>
			)}
			{definition.fields.map((field) => {
				const id = `${idPrefix}-${field.key}`;
				const saved = provider?.savedSecrets.includes(field.key) ?? false;
				if (!field.secret) {
					return (
						<Field
							key={field.key}
							label={field.label}
							htmlFor={id}
							hint={field.hint}
						>
							<input
								id={id}
								name={`field_${field.key}`}
								required={field.required}
								pattern={field.pattern}
								defaultValue={provider?.options[field.key]}
								placeholder={field.placeholder}
								className={inputClass}
							/>
						</Field>
					);
				}
				return (
					<Field
						key={field.key}
						label={field.label}
						htmlFor={id}
						hint={
							canStoreSecrets
								? field.hint
								: "Set ENCRYPTION_KEY on the server to save credentials."
						}
					>
						<input
							id={id}
							name={`field_${field.key}`}
							type="password"
							autoComplete="new-password"
							required={field.required && !saved && canStoreSecrets}
							disabled={!canStoreSecrets}
							placeholder={
								saved ? "Saved. Leave empty to keep it." : field.placeholder
							}
							className={inputClass}
						/>
						{saved && !field.required && (
							<label className="flex items-center gap-2 text-xs text-muted">
								<input
									type="checkbox"
									name="clear"
									value={field.key}
									className="size-3.5 accent-brand"
								/>
								Remove the saved {field.label.toLowerCase()}
							</label>
						)}
					</Field>
				);
			})}
		</div>
	);
}

function providerRole(
	channel: PublicNotificationChannel,
	index: number,
): string {
	if (channel.strategy === "load_balanced") {
		return "Load balanced";
	}
	return index === 0 ? "Active" : `Passive ${index}`;
}

function ProviderItem({
	channel,
	provider,
	index,
	canStoreSecrets,
}: {
	channel: PublicNotificationChannel;
	provider: PublicNotificationProvider;
	index: number;
	canStoreSecrets: boolean;
}) {
	const definition = PROVIDERS[provider.type];
	const channelDefinition = CHANNELS[channel.id];
	const hidden = (
		<>
			<input type="hidden" name="channel" value={channel.id} />
			<input type="hidden" name="id" value={provider.id} />
		</>
	);
	const details = [
		definition.label,
		providerRole(channel, index),
		...(provider.from ? [`From ${provider.from}`] : []),
		...definition.fields
			.filter(
				(field) => field.secret && provider.savedSecrets.includes(field.key),
			)
			.map((field) => `${field.label} saved`),
	];
	return (
		<li className="py-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium break-words">{provider.name}</p>
					<p className="text-xs text-muted">{details.join(" · ")}</p>
					{!provider.credentialsReadable && (
						<p role="alert" className="mt-1 text-xs text-major">
							The saved credentials do not decrypt with the keys of this server.
							Enter them again.
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-1">
					{index > 0 && (
						<form action={moveNotificationProviderAction}>
							{hidden}
							<input type="hidden" name="direction" value="up" />
							<SubmitButton className={buttonClass.ghost}>
								Move up <span className="sr-only">{provider.name}</span>
							</SubmitButton>
						</form>
					)}
					{index < channel.providers.length - 1 && (
						<form action={moveNotificationProviderAction}>
							{hidden}
							<input type="hidden" name="direction" value="down" />
							<SubmitButton className={buttonClass.ghost}>
								Move down <span className="sr-only">{provider.name}</span>
							</SubmitButton>
						</form>
					)}
					<form action={removeNotificationProviderAction}>
						{hidden}
						<ConfirmButton message={`Remove ${provider.name}?`}>
							Remove <span className="sr-only">{provider.name}</span>
						</ConfirmButton>
					</form>
				</div>
			</div>
			<details className="mt-2">
				<summary className="cursor-pointer text-sm text-muted hover:text-fg">
					Edit <span className="sr-only">{provider.name}</span>
				</summary>
				<form
					action={updateNotificationProviderAction}
					className="mt-3 space-y-4"
				>
					{hidden}
					<input type="hidden" name="revision" value={channel.revision} />
					<ProviderFields
						idPrefix={provider.id}
						channel={channelDefinition}
						definition={definition}
						provider={provider}
						canStoreSecrets={canStoreSecrets}
					/>
					<SubmitButton className={buttonClass.secondary}>
						Save provider
					</SubmitButton>
				</form>
			</details>
		</li>
	);
}

function EnvironmentNote({ channel }: { channel: PublicNotificationChannel }) {
	const names = channel.environmentProviders.map((provider) => provider.name);
	if (channel.providers.length === 0) {
		return (
			<EmptyState>
				{names.length > 0
					? `No providers yet. Until you add one, this channel uses ${names.join(", ")}.`
					: "No providers yet. Add one below."}
			</EmptyState>
		);
	}
	return names.length > 0 ? (
		<p className="mt-2 text-xs text-muted">
			This channel does not use {names.join(", ")} while it has providers.
		</p>
	) : null;
}

/** One notification channel: on or off, the send strategy, the sender and the providers. */
export function NotificationChannelCard({
	channel,
	canStoreSecrets,
}: {
	channel: PublicNotificationChannel;
	canStoreSecrets: boolean;
}) {
	const definition = CHANNELS[channel.id];
	const hasProviders =
		channel.providers.length > 0 || channel.environmentProviders.length > 0;
	return (
		<Card
			title={definition.label}
			description={definition.description}
			actions={<ChannelStatus channel={channel} />}
		>
			<form action={updateNotificationChannelAction} className="space-y-4">
				<input type="hidden" name="channel" value={channel.id} />
				<input type="hidden" name="revision" value={channel.revision} />
				<Checkbox
					name="enabled"
					label={`Send ${definition.noun} notifications`}
					defaultChecked={channel.enabled}
				/>
				<fieldset className="space-y-1.5">
					<legend className="text-sm font-medium">Delivery strategy</legend>
					<div className="grid gap-3 sm:grid-cols-2">
						{DELIVERY_STRATEGIES.map((strategy) => (
							<label
								key={strategy}
								className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-sm has-checked:border-brand has-checked:bg-brand/10"
							>
								<input
									type="radio"
									name="strategy"
									value={strategy}
									defaultChecked={channel.strategy === strategy}
									className="mt-0.5 size-4 shrink-0 accent-brand"
								/>
								<span className="min-w-0">
									<span className="block font-medium">
										{STRATEGIES[strategy].label}
									</span>
									<span className="block text-xs text-muted">
										{STRATEGIES[strategy].description}
									</span>
								</span>
							</label>
						))}
					</div>
				</fieldset>
				{definition.sender && (
					<Field
						label={definition.sender.defaultLabel}
						htmlFor={`${channel.id}-from`}
						hint={
							channel.defaultFrom
								? `${definition.sender.hint} Leave empty to use ${channel.defaultFrom} (EMAIL_FROM).`
								: definition.sender.hint
						}
					>
						<input
							id={`${channel.id}-from`}
							name="from"
							maxLength={200}
							defaultValue={channel.from}
							placeholder={channel.defaultFrom ?? definition.sender.placeholder}
							className={inputClass}
						/>
					</Field>
				)}
				{channel.enabled && !channel.available && (
					<p role="status" className="text-sm text-muted">
						{hasProviders
							? "Set a sender. The providers cannot send without one."
							: "Add a provider so this channel can send."}
					</p>
				)}
				<SubmitButton className={buttonClass.secondary}>
					Save channel
				</SubmitButton>
			</form>
			<div className="mt-6 border-t border-border pt-5">
				<h3 className="text-sm font-semibold">Providers</h3>
				{channel.providers.length > 0 && (
					<ol className="divide-y divide-border">
						{channel.providers.map((provider, index) => (
							<ProviderItem
								key={provider.id}
								channel={channel}
								provider={provider}
								index={index}
								canStoreSecrets={canStoreSecrets}
							/>
						))}
					</ol>
				)}
				<EnvironmentNote channel={channel} />
				<div className="mt-4 space-y-2">
					<h4 className="text-sm font-medium">Add a provider</h4>
					{definition.providers.map((type) => {
						const provider = PROVIDERS[type];
						return (
							<details
								key={type}
								className="rounded-lg border border-border bg-bg"
							>
								<summary className="cursor-pointer px-4 py-3 text-sm">
									<span className="font-medium">{provider.label}</span>
									<span className="text-muted"> · {provider.description}</span>
								</summary>
								<form
									action={addNotificationProviderAction}
									className="space-y-4 border-t border-border p-4"
								>
									<input type="hidden" name="channel" value={channel.id} />
									<input type="hidden" name="type" value={type} />
									<ProviderFields
										idPrefix={`${channel.id}-new-${type}`}
										channel={definition}
										definition={provider}
										canStoreSecrets={canStoreSecrets}
									/>
									<SubmitButton className={buttonClass.primary}>
										Add {provider.label}
									</SubmitButton>
								</form>
							</details>
						);
					})}
				</div>
			</div>
		</Card>
	);
}
