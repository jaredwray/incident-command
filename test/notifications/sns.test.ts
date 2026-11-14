import { AirhornAws } from "@airhornjs/aws";
import type { AirhornProviderMessage } from "airhorn";
import { SnsProvider } from "@/lib/notifications/providers";

/** The real airhorn AWS provider, with the SNS client replaced. */
function sns() {
	const aws = new AirhornAws({
		region: "us-east-1",
		accessKeyId: "AKIAIOSFODNN7EXAMPLE",
		secretAccessKey: "secret",
		capabilities: ["sms" as AirhornProviderMessage["type"]],
	});
	const send = vi.fn(async (_command: { input: Record<string, unknown> }) => ({
		MessageId: "msg_1",
		$metadata: {},
	}));
	(aws as unknown as { snsClient: { send: typeof send } }).snsClient.send =
		send;
	return { provider: new SnsProvider(aws), send };
}

const message = (from: string): AirhornProviderMessage => ({
	to: "+15551234567",
	from,
	content: "Hello",
	type: "sms" as AirhornProviderMessage["type"],
});

describe("SnsProvider", () => {
	it("sends a phone number sender as the origination number", async () => {
		const { provider, send } = sns();
		const result = await provider.send(message("+15550001111"));
		expect(result.success).toBe(true);
		const input = send.mock.calls[0]?.[0].input;
		expect(input?.PhoneNumber).toBe("+15551234567");
		expect(input?.MessageAttributes).toEqual({
			"AWS.SNS.SMS.SMSType": {
				DataType: "String",
				StringValue: "Transactional",
			},
			"AWS.MM.SMS.OriginationNumber": {
				DataType: "String",
				StringValue: "+15550001111",
			},
		});
	});

	it("sends any other sender as the sender ID", async () => {
		const { provider, send } = sns();
		expect(provider.name).toBe("aws");
		expect(provider.capabilities).toEqual(["sms"]);
		await provider.send(message("ACME"));
		expect(send.mock.calls[0]?.[0].input.MessageAttributes).toMatchObject({
			"AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: "ACME" },
		});
	});
});
