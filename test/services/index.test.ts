import { createTestContext } from "../helpers";

describe("createServices().bootstrap", () => {
	it("creates the admin from config once", async () => {
		const t = createTestContext({
			env: {
				ADMIN_EMAIL: "root@acme.dev",
				ADMIN_PASSWORD: "password123",
				ADMIN_NAME: "Root",
			},
		});
		await t.services.bootstrap();
		await t.services.bootstrap();
		expect(await t.services.members.count()).toBe(1);
		await expect(
			t.services.members.authenticate({
				email: "root@acme.dev",
				password: "password123",
			}),
		).resolves.toMatchObject({
			name: "Root",
			role: "admin",
		});
	});

	it("does nothing without admin config", async () => {
		const t = createTestContext();
		await t.services.bootstrap();
		expect(await t.services.members.count()).toBe(0);
	});
});
