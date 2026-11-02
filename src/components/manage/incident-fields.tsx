import {
	COMPONENT_STATUS_LABELS,
	EVENT_STATUS_LABELS,
	IMPACT_LABELS,
} from "@/lib/domain/status";
import {
	COMPONENT_STATUSES,
	type Component,
	type EventStatus,
	INCIDENT_IMPACTS,
	INCIDENT_STATUSES,
	type IncidentImpact,
	type IncidentKind,
	MAINTENANCE_STATUSES,
} from "@/lib/domain/types";
import { toDateTimeInput } from "@/lib/format";
import { Field, inputClass } from "./ui";

export function statusesFor(kind: IncidentKind): readonly EventStatus[] {
	return kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES;
}

export function StatusSelect({
	kind,
	value,
	id = "status",
}: {
	kind: IncidentKind;
	value?: EventStatus;
	id?: string;
}) {
	return (
		<Field label="Status" htmlFor={id}>
			<select id={id} name="status" defaultValue={value} className={inputClass}>
				{statusesFor(kind).map((status) => (
					<option key={status} value={status}>
						{EVENT_STATUS_LABELS[status]}
					</option>
				))}
			</select>
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
			<select
				id={id}
				name="impact"
				defaultValue={value ?? "minor"}
				className={inputClass}
			>
				{INCIDENT_IMPACTS.map((impact) => (
					<option key={impact} value={impact}>
						{IMPACT_LABELS[impact]}
					</option>
				))}
			</select>
		</Field>
	);
}

export function ComponentStatusSelect({
	id = "componentStatus",
	hint,
}: {
	id?: string;
	hint: string;
}) {
	return (
		<Field label="Set affected components to" htmlFor={id} hint={hint}>
			<select
				id={id}
				name="componentStatus"
				defaultValue=""
				className={inputClass}
			>
				<option value="">Automatic</option>
				{COMPONENT_STATUSES.map((status) => (
					<option key={status} value={status}>
						{COMPONENT_STATUS_LABELS[status]}
					</option>
				))}
			</select>
		</Field>
	);
}

export function ComponentPicker({
	components,
	selected = [],
}: {
	components: Component[];
	selected?: string[];
}) {
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm font-medium">Affected components</legend>
			{components.length === 0 ? (
				<p className="text-sm text-muted">No components yet.</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{components.map((component) => (
						<label
							key={component.id}
							className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
						>
							<input
								type="checkbox"
								name="componentIds"
								value={component.id}
								defaultChecked={selected.includes(component.id)}
								className="size-4 accent-brand"
							/>
							<span className="min-w-0 flex-1 truncate">{component.name}</span>
							{component.group && (
								<span className="shrink-0 text-xs text-muted">
									{component.group}
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
