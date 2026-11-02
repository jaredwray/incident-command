// @airhornjs/aws ships without type declarations; this describes the parts we use.
declare module "@airhornjs/aws" {
	import type {
		AirhornProvider,
		AirhornProviderMessage,
		AirhornProviderSendResult,
		AirhornSendType,
	} from "airhorn";

	export interface AirhornAwsOptions {
		region: string;
		accessKeyId?: string;
		secretAccessKey?: string;
		sessionToken?: string;
		capabilities?: AirhornSendType[];
	}

	export class AirhornAws implements AirhornProvider {
		name: string;
		capabilities: AirhornSendType[];
		constructor(options: AirhornAwsOptions);
		send(
			message: AirhornProviderMessage,
			options?: unknown,
		): Promise<AirhornProviderSendResult>;
	}
}
