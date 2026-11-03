import { createTestContext } from "../helpers";

describe("createServices().bootstrap", () => {
	it("does not create a member", async () => {
		const t = createTestContext();
		await t.services.bootstrap();
		expect(await t.services.members.count()).toBe(0);
	});
});
