import { createId } from "../crypto";
import {
	type AddNotificationProviderInput,
	addNotificationProviderSchema,
	type MoveDirection,
	moveDirectionSchema,
	notificationChannelSchema,
	senderSchemas,
	type UpdateNotificationChannelInput,
	type UpdateNotificationProviderInput,
	updateNotificationChannelSchema,
	updateNotificationProviderSchema,
} from "../domain/schemas";
import {
	type Actor,
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
	type NotificationChannelSettings,
	type NotificationProvider,
	type PublicNotificationChannel,
	type PublicNotificationProvider,
} from "../domain/types";
import {
	ConflictError,
	errorMessage,
	NotFoundError,
	ValidationError,
} from "../errors";
import {
	CHANNELS,
	matchesField,
	PROVIDERS,
	type ProviderDefinition,
} from "../notifications/catalog";
import {
	type DeliveryChannel,
	type DeliveryChannels,
	environmentProviders,
	type ResolvedProvider,
} from "../notifications/delivery";
import { SecretBox } from "../secrets";
import { iso, parse, requireRole, type ServiceContext } from "./context";

/** The most providers that one channel can have. */
export const MAX_PROVIDERS = 10;

export const NOTIFICATION_SETTINGS_CHANGED =
	"Somebody else changed these notification settings. Reload the page.";

/** The authenticated data of a stored secret. It binds the value to one field. */
function secretContext(
	channel: NotificationChannel,
	providerId: string,
	field: string,
): string {
	return `notification/${channel}/${providerId}/${field}`;
}

function publicProvider(
	provider: NotificationProvider,
	credentialsReadable: boolean,
): PublicNotificationProvider {
	const { secrets, ...rest } = provider;
	return { ...rest, savedSecrets: Object.keys(secrets), credentialsReadable };
}

/**
 * The delivery settings of the webhook, email and text messaging channels:
 * on or off, the airhorn send strategy, the sender, and the providers with
 * their encrypted credentials.
 */
export class NotificationSettingsService {
	private readonly ctx: ServiceContext;
	private readonly box: SecretBox;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
		this.box = new SecretBox(ctx.config.encryption);
	}

	/** True when provider credentials can be saved (`ENCRYPTION_KEY` is set). */
	get canStoreSecrets(): boolean {
		return this.box.canEncrypt;
	}

	/** Every channel without credentials, for the portal and the MCP server. */
	async list(actor: Actor): Promise<PublicNotificationChannel[]> {
		requireRole(actor, "admin");
		const channels = await this.load();
		return NOTIFICATION_CHANNELS.map((channel) =>
			this.toPublic(channels[channel]),
		);
	}

	async updateChannel(
		actor: Actor,
		channel: NotificationChannel,
		input: UpdateNotificationChannelInput,
	): Promise<PublicNotificationChannel> {
		requireRole(actor, "admin");
		const id = parse(notificationChannelSchema, channel);
		const patch = parse(updateNotificationChannelSchema, input);
		const from = this.sender(id, patch.from);
		const saved = await this.mutate(id, (current) => ({
			...current,
			enabled: patch.enabled ?? current.enabled,
			strategy: patch.strategy ?? current.strategy,
			from: from === undefined ? current.from : (from ?? undefined),
		}));
		return this.toPublic(saved);
	}

	async addProvider(
		actor: Actor,
		channel: NotificationChannel,
		input: AddNotificationProviderInput,
	): Promise<PublicNotificationProvider> {
		requireRole(actor, "admin");
		const id = parse(notificationChannelSchema, channel);
		const data = parse(addNotificationProviderSchema, input);
		const definition = PROVIDERS[data.type];
		if (definition.channel !== id) {
			throw new ValidationError(
				`A ${definition.label} provider cannot send on the ${CHANNELS[id].label} channel`,
			);
		}
		const now = iso(this.ctx.now());
		const providerId = createId("prv");
		const from = this.sender(id, data.from);
		const provider: NotificationProvider = {
			id: providerId,
			type: data.type,
			name: data.name,
			...(from ? { from } : {}),
			...this.fields(id, providerId, definition, data.values ?? {}),
			createdAt: now,
			updatedAt: now,
		};
		await this.mutate(id, (current) => {
			if (current.providers.length >= MAX_PROVIDERS) {
				throw new ValidationError(
					`A channel can have at most ${MAX_PROVIDERS} providers`,
				);
			}
			return { ...current, providers: [...current.providers, provider] };
		});
		return publicProvider(provider, true);
	}

	async updateProvider(
		actor: Actor,
		channel: NotificationChannel,
		providerId: string,
		input: UpdateNotificationProviderInput,
	): Promise<PublicNotificationProvider> {
		requireRole(actor, "admin");
		const id = parse(notificationChannelSchema, channel);
		const data = parse(updateNotificationProviderSchema, input);
		const from = this.sender(id, data.from);
		const saved = await this.mutate(id, (current) => {
			const existing = this.findProvider(current, providerId);
			const next: NotificationProvider = {
				...existing,
				name: data.name ?? existing.name,
				...this.fields(
					id,
					providerId,
					PROVIDERS[existing.type],
					data.values ?? {},
					existing,
					data.clear ?? [],
				),
				updatedAt: iso(this.ctx.now()),
			};
			if (from === null) {
				delete next.from;
			} else if (from !== undefined) {
				next.from = from;
			}
			return {
				...current,
				providers: current.providers.map((provider) =>
					provider.id === providerId ? next : provider,
				),
			};
		});
		return publicProvider(this.findProvider(saved, providerId), true);
	}

	async removeProvider(
		actor: Actor,
		channel: NotificationChannel,
		providerId: string,
	): Promise<void> {
		requireRole(actor, "admin");
		const id = parse(notificationChannelSchema, channel);
		await this.mutate(id, (current) => {
			this.findProvider(current, providerId);
			return {
				...current,
				providers: current.providers.filter(
					(provider) => provider.id !== providerId,
				),
			};
		});
	}

	/** Moves a provider one place. With active/passive, the first provider is active. */
	async moveProvider(
		actor: Actor,
		channel: NotificationChannel,
		providerId: string,
		direction: MoveDirection,
	): Promise<void> {
		requireRole(actor, "admin");
		const id = parse(notificationChannelSchema, channel);
		const step = parse(moveDirectionSchema, direction) === "up" ? -1 : 1;
		await this.mutate(id, (current) => {
			const provider = this.findProvider(current, providerId);
			const providers = current.providers.filter(
				(item) => item.id !== providerId,
			);
			const index = current.providers.indexOf(provider) + step;
			providers.splice(
				Math.min(Math.max(index, 0), providers.length),
				0,
				provider,
			);
			return { ...current, providers };
		});
	}

	/** Which channels can deliver now. Public: it reveals no settings. */
	async availability(): Promise<Record<NotificationChannel, boolean>> {
		const channels = await this.load();
		return {
			webhook: this.available(channels.webhook),
			email: this.available(channels.email),
			sms: this.available(channels.sms),
		};
	}

	/**
	 * The channels with decrypted credentials, for the notifier only. A
	 * provider whose credentials do not decrypt is left out and logged.
	 */
	async resolve(): Promise<DeliveryChannels> {
		const channels = await this.load();
		return {
			webhook: this.deliveryChannel(channels.webhook),
			email: this.deliveryChannel(channels.email),
			sms: this.deliveryChannel(channels.sms),
		};
	}

	// ---- internals -------------------------------------------------------------

	private defaults(channel: NotificationChannel): NotificationChannelSettings {
		return {
			id: channel,
			enabled: true,
			strategy: "active_passive",
			providers: [],
			revision: 0,
			updatedAt: new Date(0).toISOString(),
		};
	}

	private async load(): Promise<
		Record<NotificationChannel, NotificationChannelSettings>
	> {
		const stored = await this.ctx.store.find("notification_channels");
		const byId = new Map(stored.map((doc) => [doc.id, doc]));
		return {
			webhook: byId.get("webhook") ?? this.defaults("webhook"),
			email: byId.get("email") ?? this.defaults("email"),
			sms: byId.get("sms") ?? this.defaults("sms"),
		};
	}

	/**
	 * Reads the channel, applies a change and writes it back if nobody else
	 * wrote it meanwhile. Each write also encrypts again any secret that an
	 * old key (`ENCRYPTION_KEY_PREVIOUS`) encrypted.
	 */
	private async mutate(
		channel: NotificationChannel,
		change: (
			current: NotificationChannelSettings,
		) => NotificationChannelSettings,
	): Promise<NotificationChannelSettings> {
		const stored = await this.ctx.store.get("notification_channels", channel, {
			consistent: true,
		});
		const current = stored ?? this.defaults(channel);
		const changed = change(current);
		const next: NotificationChannelSettings = {
			...changed,
			providers: changed.providers.map((provider) =>
				this.rotate(channel, provider),
			),
			revision: current.revision + 1,
			updatedAt: iso(this.ctx.now()),
		};
		if (next.from === undefined) {
			delete next.from;
		}
		if (!stored) {
			return this.ctx.store.insert("notification_channels", next);
		}
		const saved = await this.ctx.store.update("notification_channels", next, {
			where: [{ field: "revision", op: "eq", value: current.revision }],
		});
		if (!saved) {
			throw new ConflictError(NOTIFICATION_SETTINGS_CHANGED);
		}
		return saved;
	}

	private rotate(
		channel: NotificationChannel,
		provider: NotificationProvider,
	): NotificationProvider {
		const secrets = Object.fromEntries(
			Object.entries(provider.secrets).map(([field, value]) => [
				field,
				this.box.rotate(value, secretContext(channel, provider.id, field)),
			]),
		);
		return { ...provider, secrets };
	}

	private findProvider(
		channel: NotificationChannelSettings,
		providerId: string,
	): NotificationProvider {
		const provider = channel.providers.find((item) => item.id === providerId);
		if (!provider) {
			throw new NotFoundError("Provider", providerId);
		}
		return provider;
	}

	/** Validates a sender patch: `undefined` keeps, `null` clears, text sets. */
	private sender(
		channel: NotificationChannel,
		value: string | null | undefined,
	): string | null | undefined {
		if (value === undefined || value === null) {
			return value;
		}
		if (channel === "webhook") {
			throw new ValidationError("Webhooks have no sender");
		}
		return parse(senderSchemas[channel], value);
	}

	/**
	 * Validates the field values of a provider and encrypts the secrets. A
	 * missing option keeps its value. An empty option clears it. An empty
	 * secret keeps its stored value, unless `clear` names it.
	 */
	private fields(
		channel: NotificationChannel,
		providerId: string,
		definition: ProviderDefinition,
		values: Record<string, string>,
		existing?: NotificationProvider,
		clear: readonly string[] = [],
	): Pick<NotificationProvider, "options" | "secrets"> {
		const byKey = new Map(definition.fields.map((field) => [field.key, field]));
		for (const key of Object.keys(values)) {
			if (!byKey.has(key)) {
				throw new ValidationError(
					`${definition.label} has no field named "${key}"`,
				);
			}
		}
		for (const key of clear) {
			if (!byKey.get(key)?.secret) {
				throw new ValidationError(
					`${definition.label} has no secret field named "${key}"`,
				);
			}
		}
		const options: Record<string, string> = {};
		const secrets: Record<string, string> = {};
		const pending: [string, string][] = [];
		for (const field of definition.fields) {
			const value = values[field.key] ?? "";
			if (value && !matchesField(field, value)) {
				throw new ValidationError(`${field.label}: the value is not valid`);
			}
			const kept = field.secret
				? clear.includes(field.key)
					? undefined
					: existing?.secrets[field.key]
				: field.key in values
					? undefined
					: existing?.options[field.key];
			if (value && field.secret) {
				pending.push([field.key, value]);
			} else if (value) {
				options[field.key] = value;
			} else if (kept !== undefined) {
				(field.secret ? secrets : options)[field.key] = kept;
			}
			if (field.required && !value && kept === undefined) {
				throw new ValidationError(`${field.label} is required`);
			}
		}
		for (const group of definition.together ?? []) {
			const filled = group.filter(
				(key) =>
					key in options || key in secrets || pending.some(([k]) => k === key),
			);
			if (filled.length > 0 && filled.length < group.length) {
				const labels = definition.fields
					.filter((field) => group.includes(field.key))
					.map((field) => field.label);
				throw new ValidationError(
					`Set ${labels.join(" and ")} together, or leave them all empty`,
				);
			}
		}
		for (const [key, value] of pending) {
			secrets[key] = this.box.encrypt(
				value,
				secretContext(channel, providerId, key),
			);
		}
		return { options, secrets };
	}

	private defaultFrom(channel: NotificationChannel): string | undefined {
		return channel === "email" ? this.ctx.config.emailFrom : undefined;
	}

	/** The providers that send: the ones of the channel, else the environment ones. */
	private effectiveProviders(
		channel: NotificationChannelSettings,
	): { from?: string }[] {
		return channel.providers.length > 0
			? channel.providers
			: environmentProviders(this.ctx.config, channel.id);
	}

	private available(channel: NotificationChannelSettings): boolean {
		const needsSender = CHANNELS[channel.id].sender !== undefined;
		const fallback = channel.from ?? this.defaultFrom(channel.id);
		return (
			channel.enabled &&
			this.effectiveProviders(channel).some(
				(provider) => !needsSender || Boolean(provider.from ?? fallback),
			)
		);
	}

	private decryptSecrets(
		channel: NotificationChannel,
		provider: NotificationProvider,
	): Record<string, string> {
		return Object.fromEntries(
			Object.entries(provider.secrets).map(([field, value]) => [
				field,
				this.box.decrypt(value, secretContext(channel, provider.id, field)),
			]),
		);
	}

	private readable(
		channel: NotificationChannel,
		provider: NotificationProvider,
	): boolean {
		try {
			this.decryptSecrets(channel, provider);
			return true;
		} catch {
			return false;
		}
	}

	private toPublic(
		channel: NotificationChannelSettings,
	): PublicNotificationChannel {
		const { providers, ...rest } = channel;
		return {
			...rest,
			providers: providers.map((provider) =>
				publicProvider(provider, this.readable(channel.id, provider)),
			),
			environmentProviders: environmentProviders(
				this.ctx.config,
				channel.id,
			).map(({ type, name }) => ({ type, name })),
			defaultFrom: this.defaultFrom(channel.id),
			available: this.available(channel),
		};
	}

	private deliveryChannel(
		channel: NotificationChannelSettings,
	): DeliveryChannel {
		const sender = channel.from ?? this.defaultFrom(channel.id);
		const providers =
			channel.providers.length > 0
				? channel.providers.flatMap((provider) =>
						this.resolveProvider(channel.id, provider, sender),
					)
				: environmentProviders(this.ctx.config, channel.id).map((provider) => ({
						...provider,
						from: sender,
					}));
		return {
			channel: channel.id,
			enabled: channel.enabled,
			strategy: channel.strategy,
			providers,
			version: `${channel.updatedAt}#${channel.revision}`,
		};
	}

	private resolveProvider(
		channel: NotificationChannel,
		provider: NotificationProvider,
		sender: string | undefined,
	): ResolvedProvider[] {
		try {
			return [
				{
					id: provider.id,
					type: provider.type,
					name: provider.name,
					from: provider.from ?? sender,
					options: provider.options,
					secrets: this.decryptSecrets(channel, provider),
				},
			];
		} catch (error) {
			console.error(
				`[notifications] skipped provider "${provider.name}": ${errorMessage(error)}`,
			);
			return [];
		}
	}
}
