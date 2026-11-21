import type { QueueProviderId } from "../domain/types";

export interface QueueProviderDefinition {
	label: string;
	hint: string;
	uri: { default: string; pattern: string };
}

export const QUEUE_PROVIDERS: Record<QueueProviderId, QueueProviderDefinition> =
	{
		redis: {
			label: "Redis",
			hint: "Redis keeps the tasks.",
			uri: { default: "redis://localhost:6379", pattern: "^rediss?://\\S+$" },
		},
		rabbitmq: {
			label: "RabbitMQ",
			hint: "RabbitMQ keeps the tasks.",
			uri: { default: "amqp://localhost:5672", pattern: "^amqps?://\\S+$" },
		},
		nats: {
			label: "NATS",
			hint: "JetStream must be on in the NATS server.",
			uri: { default: "localhost:4222", pattern: "^\\S+$" },
		},
	};
