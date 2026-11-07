import {
	EVENT_STATUS_LABELS,
	IMPACT_LABELS,
	SERVICE_STATUS_LABELS,
} from "@/lib/domain/status";
import {
	type EventStatus,
	INCIDENT_IMPACTS,
	INCIDENT_STATUSES,
	type IncidentImpact,
	type IncidentKind,
	MAINTENANCE_STATUSES,
	SERVICE_STATUSES,
	type Service,
	type ServiceStatus,
} from "@/lib/domain/types";
import { toDateTimeInput } from "@/lib/format";
import { Field, inputClass, Select } from "./ui";

export function statusesFor(kind: IncidentKind): readonly EventStatus[] {
	return kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES;
}

export function StatusSelect({
	kind,
	value,
	id = "status",
	keepLabel,
}: {
	kind: IncidentKind;
	value?: EventStatus;
	id?: string;
	/** Adds a first option with an empty value. It keeps the current status. */
	keepLabel?: string;
}) {
	return (
		<Field label="Status" htmlFor={id}>
			<Select
				id={id}
				name="status"
				defaultValue={value ?? (keepLabel ? "" : undefined)}
			>
				{keepLabel && <option value="">{keepLabel}</option>}
				{statusesFor(kind).map((status) => (
					<option key={status} value={status}>
						{EVENT_STATUS_LABELS[status]}
					</option>
				))}
			</Select>
		</Field>
	);
}

export function ImpactSelect({
	value,
	id = "impact",
}: {
	value?: IncidentImpact;
	id?: string;
}) {
	return (
		<Field label="Impact" htmlFor={id}>
			<Select id={id} name="impact" defaultValue={value ?? "minor"}>
				{INCIDENT_IMPACTS.map((impact) => (
					<option key={impact} value={impact}>
						{IMPACT_LABELS[impact]}
					</option>
				))}
			</Select>
		</Field>
	);
}

export function ServiceStatusSelect({
	id = "serviceStatus",
	hint,
	value,
}: {
	id?: string;
	hint: string;
	value?: ServiceStatus;
}) {
	return (
		<Field label="Set affected services to" htmlFor={id} hint={hint}>
			<Select id={id} name="serviceStatus" defaultValue={value ?? ""}>
				<option value="">Automatic</option>
				{SERVICE_STATUSES.map((status) => (
					<option key={status} value={status}>
						{SERVICE_STATUS_LABELS[status]}
					</option>
				))}
			</Select>
		</Field>
	);
}

export function ServicePicker({
	services,
	selected = [],
}: {
	services: Service[];
	selected?: string[];
}) {
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm font-medium">Affected services</legend>
			{services.length === 0 ? (
				<p className="text-sm text-muted">No services yet.</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{services.map((service) => (
						<label
							key={service.id}
							className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
						>
							<input
								type="checkbox"
								name="serviceIds"
								value={service.id}
								defaultChecked={selected.includes(service.id)}
								className="size-4 accent-brand"
							/>
							<span className="min-w-0 flex-1 truncate">{service.name}</span>
							{service.group && (
								<span className="shrink-0 text-xs text-muted">
									{service.group}
								</span>
							)}
						</label>
					))}
				</div>
			)}
		</fieldset>
	);
}

export function WindowFields({ start, end }: { start?: string; end?: string }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<Field label="Starts (UTC)" htmlFor="scheduledStart">
				<input
					id="scheduledStart"
					name="scheduledStart"
					type="datetime-local"
					defaultValue={toDateTimeInput(start)}
					className={inputClass}
				/>
			</Field>
			<Field label="Ends (UTC)" htmlFor="scheduledEnd">
				<input
					id="scheduledEnd"
					name="scheduledEnd"
					type="datetime-local"
					defaultValue={toDateTimeInput(end)}
					className={inputClass}
				/>
			</Field>
		</div>
	);
}
