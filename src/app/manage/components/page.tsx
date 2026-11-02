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
import { COMPONENT_STATUS_LABELS, hasRole } from "@/lib/domain/status";
import { COMPONENT_STATUSES } from "@/lib/domain/types";
import {
	createComponentAction,
	deleteComponentAction,
	setComponentStatusAction,
	updateComponentAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Components" };

export default async function ComponentsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const [settings, components] = await Promise.all([
		services.settings.get(),
		services.components.list(),
	]);
	const canEdit = hasRole(member.role, "editor");
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="components"
			title="Components"
			flash={flash}
			health={app.store.health}
		>
			<Card
				title="All components"
				description="Components appear on the status page in this order, grouped by group name."
			>
				{components.length === 0 ? (
					<EmptyState>
						No components yet. Add the services your customers rely on.
					</EmptyState>
				) : (
					<ul className="divide-y divide-border">
						{components.map((component) => (
							<li key={component.id} className="space-y-3 py-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<p className="font-medium">
											{component.name}
											{component.hidden && (
												<span className="ml-2 text-xs text-muted">
													(hidden)
												</span>
											)}
										</p>
										<p className="text-xs text-muted">
											{component.group ? `${component.group} · ` : ""}order{" "}
											{component.order}
										</p>
									</div>
									{canEdit ? (
										<form
											action={setComponentStatusAction}
											className="flex items-center gap-2"
										>
											<input type="hidden" name="id" value={component.id} />
											<label
												htmlFor={`status-${component.id}`}
												className="sr-only"
											>
												Status of {component.name}
											</label>
											<select
												id={`status-${component.id}`}
												name="status"
												defaultValue={component.status}
												className={`${inputClass} w-auto`}
											>
												{COMPONENT_STATUSES.map((status) => (
													<option key={status} value={status}>
														{COMPONENT_STATUS_LABELS[status]}
													</option>
												))}
											</select>
											<button type="submit" className={buttonClass.secondary}>
												Set
											</button>
										</form>
									) : (
										<StatusBadge status={component.status} />
									)}
								</div>
								{canEdit && (
									<details className="rounded-lg border border-border">
										<summary className="cursor-pointer px-3 py-2 text-sm text-muted">
											Edit details
										</summary>
										<div className="space-y-4 border-t border-border p-4">
											<form
												action={updateComponentAction}
												className="space-y-4"
											>
												<input type="hidden" name="id" value={component.id} />
												<div className="grid gap-4 sm:grid-cols-2">
													<Field label="Name" htmlFor={`name-${component.id}`}>
														<input
															id={`name-${component.id}`}
															name="name"
															defaultValue={component.name}
															required
															className={inputClass}
														/>
													</Field>
													<Field
														label="Group"
														htmlFor={`group-${component.id}`}
													>
														<input
															id={`group-${component.id}`}
															name="group"
															defaultValue={component.group}
															className={inputClass}
														/>
													</Field>
												</div>
												<Field
													label="Description"
													htmlFor={`description-${component.id}`}
												>
													<input
														id={`description-${component.id}`}
														name="description"
														defaultValue={component.description}
														className={inputClass}
													/>
												</Field>
												<div className="flex flex-wrap items-end gap-4">
													<Field
														label="Order"
														htmlFor={`order-${component.id}`}
													>
														<input
															id={`order-${component.id}`}
															name="order"
															type="number"
															defaultValue={component.order}
															className={`${inputClass} w-24`}
														/>
													</Field>
													<Checkbox
														name="hidden"
														label="Hide from status page"
														defaultChecked={component.hidden}
													/>
												</div>
												<button type="submit" className={buttonClass.secondary}>
													Save
												</button>
											</form>
											<form action={deleteComponentAction}>
												<input type="hidden" name="id" value={component.id} />
												<ConfirmButton
													message={`Delete ${component.name} and its uptime history?`}
												>
													Delete component
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
				<Card title="Add a component">
					<form action={createComponentAction} className="space-y-4">
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
							Add component
						</button>
					</form>
				</Card>
			)}
		</ManageShell>
	);
}
