import { createId } from "../crypto";
import {
	type CreateComponentInput,
	createComponentSchema,
	type UpdateComponentInput,
	updateComponentSchema,
} from "../domain/schemas";
import type { Actor, Component, ComponentStatus } from "../domain/types";
import { NotFoundError } from "../errors";
import { iso, parse, requireRole, type ServiceContext } from "./context";

export class ComponentService {
	private readonly ctx: ServiceContext;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
	}

	/** All components ordered for display. */
	async list(options: { includeHidden?: boolean } = {}): Promise<Component[]> {
		const components = await this.ctx.store.find("components", {
			sort: [{ field: "order" }, { field: "createdAt" }],
		});
		return options.includeHidden === false
			? components.filter((component) => !component.hidden)
			: components;
	}

	async get(id: string): Promise<Component> {
		const component = await this.ctx.store.get("components", id);
		if (!component) {
			throw new NotFoundError("Component", id);
		}
		return component;
	}

	async create(actor: Actor, input: CreateComponentInput): Promise<Component> {
		requireRole(actor, "editor");
		const data = parse(createComponentSchema, input);
		const now = iso(this.ctx.now());
		const component: Component = {
			id: createId("cmp"),
			name: data.name,
			status: data.status ?? "operational",
			order: data.order ?? (await this.ctx.store.count("components")),
			hidden: data.hidden ?? false,
			createdAt: now,
			updatedAt: now,
		};
		if (data.description) component.description = data.description;
		if (data.group) component.group = data.group;
		return this.ctx.store.insert("components", component);
	}

	async update(
		actor: Actor,
		id: string,
		input: UpdateComponentInput,
	): Promise<Component> {
		requireRole(actor, "editor");
		const patch = parse(updateComponentSchema, input);
		const current = await this.load(id);
		const next: Component = {
			...current,
			name: patch.name ?? current.name,
			order: patch.order ?? current.order,
			hidden: patch.hidden ?? current.hidden,
			updatedAt: iso(this.ctx.now()),
		};
		for (const key of ["description", "group"] as const) {
			const value = patch[key];
			if (value === null) {
				delete next[key];
			} else if (value !== undefined) {
				next[key] = value;
			}
		}
		await this.ctx.store.update("components", next);
		if (patch.status && patch.status !== current.status) {
			return this.applyStatus(next, patch.status);
		}
		return next;
	}

	async setStatus(
		actor: Actor,
		id: string,
		status: ComponentStatus,
	): Promise<Component> {
		requireRole(actor, "editor");
		return this.applyStatus(await this.load(id), status);
	}

	/**
	 * Changes a component's status and records the change for uptime history.
	 * No-op when the status is unchanged.
	 */
	async applyStatus(
		component: Component,
		status: ComponentStatus,
		incidentId?: string,
	): Promise<Component> {
		if (component.status === status) {
			return component;
		}
		const now = iso(this.ctx.now());
		const next: Component = { ...component, status, updatedAt: now };
		await this.ctx.store.update("components", next);
		await this.ctx.store.insert("component_status_changes", {
			id: createId("csc"),
			componentId: component.id,
			status,
			previousStatus: component.status,
			createdAt: now,
			...(incidentId ? { incidentId } : {}),
		});
		return next;
	}

	/** Reorders components to match the given id order. Unknown ids are ignored. */
	async reorder(actor: Actor, ids: readonly string[]): Promise<Component[]> {
		requireRole(actor, "editor");
		const components = await this.ctx.store.find("components", undefined, {
			consistent: true,
		});
		const byId = new Map(
			components.map((component) => [component.id, component]),
		);
		let order = 0;
		for (const id of ids) {
			const component = byId.get(id);
			if (component) {
				await this.ctx.store.update("components", {
					...component,
					order: order++,
				});
			}
		}
		return this.list();
	}

	async delete(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "editor");
		if (!(await this.ctx.store.delete("components", id))) {
			throw new NotFoundError("Component", id);
		}
		await this.ctx.store.deleteMany("component_status_changes", {
			where: [{ field: "componentId", op: "eq", value: id }],
		});
	}

	private async load(id: string): Promise<Component> {
		const component = await this.ctx.store.get("components", id, {
			consistent: true,
		});
		if (!component) {
			throw new NotFoundError("Component", id);
		}
		return component;
	}
}
