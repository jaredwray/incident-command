import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	ADMIN,
	createTestContext,
	EDITOR,
	type TestContext,
	VIEWER,
} from "../helpers";

describe("ServiceCatalog", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("creates services with defaults and sequential order", async () => {
		const api = await t.services.catalog.create(EDITOR, {
			name: " API ",
			description: "Public API",
			group: "Core",
		});
		expect(api).toMatchObject({
			name: "API",
			description: "Public API",
			group: "Core",
			status: "operational",
			order: 0,
			hidden: false,
		});
		expect(api.id).toMatch(/^svc_/);
		const web = await t.services.catalog.create(EDITOR, {
			name: "Web",
			description: "",
			status: "degraded_performance",
			hidden: true,
			order: 9,
		});
		expect(web).toMatchObject({
			order: 9,
			hidden: true,
			status: "degraded_performance",
		});
		expect(web.description).toBeUndefined();
		expect(
			(await t.services.catalog.create(EDITOR, { name: "Docs" })).order,
		).toBe(2);
	});

	it("lists in order and can hide hidden services", async () => {
		await t.services.catalog.create(EDITOR, { name: "B", order: 2 });
		await t.services.catalog.create(EDITOR, {
			name: "A",
			order: 1,
			hidden: true,
		});
		expect((await t.services.catalog.list()).map((c) => c.name)).toEqual([
			"A",
			"B",
		]);
		expect(
			(await t.services.catalog.list({ includeHidden: false })).map(
				(c) => c.name,
			),
		).toEqual(["B"]);
	});

	it("updates fields, clears optional ones and records status changes", async () => {
		const api = await t.services.catalog.create(EDITOR, {
			name: "API",
			description: "d",
			group: "g",
		});
		t.clock.advance(1000);
		const updated = await t.services.catalog.update(EDITOR, api.id, {
			name: "API v2",
			description: null,
			group: "",
			status: "major_outage",
			hidden: true,
			order: 5,
		});
		expect(updated).toMatchObject({
			name: "API v2",
			status: "major_outage",
			hidden: true,
			order: 5,
		});
		expect(updated.description).toBeUndefined();
		expect(updated.group).toBeUndefined();
		const changes = await t.store.find("service_status_changes");
		expect(changes).toMatchObject([
			{
				serviceId: api.id,
				previousStatus: "operational",
				status: "major_outage",
			},
		]);
		expect(changes[0]?.incidentId).toBeUndefined();

		const regrouped = await t.services.catalog.update(EDITOR, api.id, {
			group: "Edge",
			status: "major_outage",
		});
		expect(regrouped.group).toBe("Edge");
		expect(await t.store.count("service_status_changes")).toBe(1);
		const same = await t.services.catalog.update(EDITOR, api.id, {});
		expect(same).toMatchObject({
			name: "API v2",
			group: "Edge",
			order: 5,
			hidden: true,
		});
	});

	it("sets status directly and ignores no-op changes", async () => {
		const api = await t.services.catalog.create(EDITOR, { name: "API" });
		await t.services.catalog.setStatus(EDITOR, api.id, "partial_outage");
		await t.services.catalog.setStatus(EDITOR, api.id, "partial_outage");
		expect(await t.store.count("service_status_changes")).toBe(1);
		expect((await t.services.catalog.get(api.id)).status).toBe(
			"partial_outage",
		);
	});

	it("reorders services", async () => {
		const a = await t.services.catalog.create(EDITOR, { name: "A" });
		const b = await t.services.catalog.create(EDITOR, { name: "B" });
		const c = await t.services.catalog.create(EDITOR, { name: "C" });
		const list = await t.services.catalog.reorder(EDITOR, [
			c.id,
			"unknown",
			a.id,
			b.id,
		]);
		expect(list.map((x) => x.name)).toEqual(["C", "A", "B"]);
	});

	it("deletes services and their history", async () => {
		const api = await t.services.catalog.create(EDITOR, { name: "API" });
		await t.services.catalog.setStatus(EDITOR, api.id, "major_outage");
		await t.services.catalog.delete(ADMIN, api.id);
		expect(await t.store.count("service_status_changes")).toBe(0);
		await expect(t.services.catalog.get(api.id)).rejects.toBeInstanceOf(
			NotFoundError,
		);
		await expect(
			t.services.catalog.delete(ADMIN, api.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.catalog.update(ADMIN, api.id, {}),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("enforces roles and validation", async () => {
		await expect(
			t.services.catalog.create(VIEWER, { name: "x" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			t.services.catalog.create(EDITOR, { name: "" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.catalog.create(EDITOR, {
				name: "x",
				status: "broken" as never,
			}),
		).rejects.toThrow(/status/);
		const api = await t.services.catalog.create(EDITOR, { name: "API" });
		await expect(
			t.services.catalog.setStatus(EDITOR, api.id, "broken" as never),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
