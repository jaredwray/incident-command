import { createId } from "../crypto";
import {
	type CreateServiceInput,
	createServiceSchema,
	serviceStatusSchema,
	type UpdateServiceInput,
	updateServiceSchema,
} from "../domain/schemas";
import type { Actor, Service, ServiceStatus } from "../domain/types";
import { NotFoundError } from "../errors";
import { iso, parse, requireRole, type ServiceContext } from "./context";

export class ServiceCatalog {
	private readonly ctx: ServiceContext;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
	}

	/** All services ordered for display. */
	async list(options: { includeHidden?: boolean } = {}): Promise<Service[]> {
		const services = await this.ctx.store.find("services", {
			sort: [{ field: "order" }, { field: "createdAt" }],
		});
		return options.includeHidden === false
			? services.filter((service) => !service.hidden)
			: services;
	}

	async get(id: string): Promise<Service> {
		const service = await this.ctx.store.get("services", id);
		if (!service) {
			throw new NotFoundError("Service", id);
		}
		return service;
	}

	async create(actor: Actor, input: CreateServiceInput): Promise<Service> {
		requireRole(actor, "editor");
		const data = parse(createServiceSchema, input);
		const now = iso(this.ctx.now());
		const service: Service = {
			id: createId("svc"),
			name: data.name,
			status: data.status ?? "operational",
			order: data.order ?? (await this.ctx.store.count("services")),
			hidden: data.hidden ?? false,
			createdAt: now,
			updatedAt: now,
		};
		if (data.description) service.description = data.description;
		if (data.group) service.group = data.group;
		return this.ctx.store.insert("services", service);
	}

	async update(
		actor: Actor,
		id: string,
		input: UpdateServiceInput,
	): Promise<Service> {
		requireRole(actor, "editor");
		const patch = parse(updateServiceSchema, input);
		const current = await this.load(id);
		const next: Service = {
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
		await this.ctx.store.update("services", next);
		if (patch.status && patch.status !== current.status) {
			return this.applyStatus(next, patch.status);
		}
		return next;
	}

	async setStatus(
		actor: Actor,
		id: string,
		status: ServiceStatus,
	): Promise<Service> {
		requireRole(actor, "editor");
		const next = parse(serviceStatusSchema, status);
		return this.applyStatus(await this.load(id), next);
	}

	/**
	 * Changes a service's status and records the change for uptime history.
	 * No-op when the status is unchanged.
	 */
	async applyStatus(
		service: Service,
		status: ServiceStatus,
		incidentId?: string,
	): Promise<Service> {
		if (service.status === status) {
			return service;
		}
		const now = iso(this.ctx.now());
		const next: Service = { ...service, status, updatedAt: now };
		await this.ctx.store.update("services", next);
		await this.ctx.store.insert("service_status_changes", {
			id: createId("ssc"),
			serviceId: service.id,
			status,
			previousStatus: service.status,
			createdAt: now,
			...(incidentId ? { incidentId } : {}),
		});
		return next;
	}

	/** Reorders services to match the given id order. Unknown ids are ignored. */
	async reorder(actor: Actor, ids: readonly string[]): Promise<Service[]> {
		requireRole(actor, "editor");
		const services = await this.ctx.store.find("services", undefined, {
			consistent: true,
		});
		const byId = new Map(services.map((service) => [service.id, service]));
		let order = 0;
		for (const id of ids) {
			const service = byId.get(id);
			if (service) {
				await this.ctx.store.update("services", {
					...service,
					order: order++,
				});
			}
		}
		return this.list();
	}

	async delete(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "editor");
		if (!(await this.ctx.store.delete("services", id))) {
			throw new NotFoundError("Service", id);
		}
		await this.ctx.store.deleteMany("service_status_changes", {
			where: [{ field: "serviceId", op: "eq", value: id }],
		});
	}

	private async load(id: string): Promise<Service> {
		const service = await this.ctx.store.get("services", id, {
			consistent: true,
		});
		if (!service) {
			throw new NotFoundError("Service", id);
		}
		return service;
	}
}
