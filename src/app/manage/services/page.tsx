import type { Metadata } from "next";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	Checkbox,
	EmptyState,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { StatusBadge } from "@/components/status/badges";
import { requireMember } from "@/lib/auth";
import { hasRole, SERVICE_STATUS_LABELS } from "@/lib/domain/status";
import { SERVICE_STATUSES } from "@/lib/domain/types";
import {
	createServiceAction,
	deleteServiceAction,
	setServiceStatusAction,
	updateServiceAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const [settings, catalog] = await Promise.all([
		services.settings.get(),
		services.catalog.list(),
	]);
	const canEdit = hasRole(member.role, "editor");
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="services"
			title="Services"
			flash={flash}
			health={app.store.health}
		>
			<Card
				title="All services"
				description="Services appear on the status page in this order, grouped by group name."
			>
				{catalog.length === 0 ? (
					<EmptyState>
						No services yet. Add the systems your customers rely on.
					</EmptyState>
				) : (
					<ul className="divide-y divide-border">
						{catalog.map((service) => (
							<li key={service.id} className="space-y-3 py-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<p className="font-medium">
											{service.name}
											{service.hidden && (
												<span className="ml-2 text-xs text-muted">
													(hidden)
												</span>
											)}
										</p>
										<p className="text-xs text-muted">
											{service.group ? `${service.group} · ` : ""}order{" "}
											{service.order}
										</p>
									</div>
									{canEdit ? (
										<form
											action={setServiceStatusAction}
											className="flex items-center gap-2"
										>
											<input type="hidden" name="id" value={service.id} />
											<label
												htmlFor={`status-${service.id}`}
												className="sr-only"
											>
												Status of {service.name}
											</label>
											<select
												id={`status-${service.id}`}
												name="status"
												defaultValue={service.status}
												className={`${inputClass} w-auto`}
											>
												{SERVICE_STATUSES.map((status) => (
													<option key={status} value={status}>
														{SERVICE_STATUS_LABELS[status]}
													</option>
												))}
											</select>
											<button type="submit" className={buttonClass.secondary}>
												Set
											</button>
										</form>
									) : (
										<StatusBadge status={service.status} />
									)}
								</div>
								{canEdit && (
									<details className="rounded-lg border border-border">
										<summary className="cursor-pointer px-3 py-2 text-sm text-muted">
											Edit details
										</summary>
										<div className="space-y-4 border-t border-border p-4">
											<form action={updateServiceAction} className="space-y-4">
												<input type="hidden" name="id" value={service.id} />
												<div className="grid gap-4 sm:grid-cols-2">
													<Field label="Name" htmlFor={`name-${service.id}`}>
														<input
															id={`name-${service.id}`}
															name="name"
															defaultValue={service.name}
															required
															className={inputClass}
														/>
													</Field>
													<Field label="Group" htmlFor={`group-${service.id}`}>
														<input
															id={`group-${service.id}`}
															name="group"
															defaultValue={service.group}
															className={inputClass}
														/>
													</Field>
												</div>
												<Field
													label="Description"
													htmlFor={`description-${service.id}`}
												>
													<input
														id={`description-${service.id}`}
														name="description"
														defaultValue={service.description}
														className={inputClass}
													/>
												</Field>
												<div className="flex flex-wrap items-end gap-4">
													<Field label="Order" htmlFor={`order-${service.id}`}>
														<input
															id={`order-${service.id}`}
															name="order"
															type="number"
															defaultValue={service.order}
															className={`${inputClass} w-24`}
														/>
													</Field>
													<Checkbox
														name="hidden"
														label="Hide from status page"
														defaultChecked={service.hidden}
													/>
												</div>
												<button type="submit" className={buttonClass.secondary}>
													Save
												</button>
											</form>
											<form action={deleteServiceAction}>
												<input type="hidden" name="id" value={service.id} />
												<ConfirmButton
													message={`Delete ${service.name} and its uptime history?`}
												>
													Delete service
												</ConfirmButton>
											</form>
										</div>
									</details>
								)}
							</li>
						))}
					</ul>
				)}
			</Card>
			{canEdit && (
				<Card title="Add a service">
					<form action={createServiceAction} className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<Field label="Name" htmlFor="new-name">
								<input
									id="new-name"
									name="name"
									required
									placeholder="API"
									className={inputClass}
								/>
							</Field>
							<Field
								label="Group"
								htmlFor="new-group"
								hint="Optional, e.g. “Core services”."
							>
								<input id="new-group" name="group" className={inputClass} />
							</Field>
						</div>
						<Field label="Description" htmlFor="new-description">
							<input
								id="new-description"
								name="description"
								className={inputClass}
							/>
						</Field>
						<Checkbox name="hidden" label="Hide from status page" />
						<button type="submit" className={buttonClass.primary}>
							Add service
						</button>
					</form>
				</Card>
			)}
		</ManageShell>
	);
}
