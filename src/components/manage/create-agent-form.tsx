"use client";

import { useActionState } from "react";
import type { CreateAgentState } from "@/app/manage/actions";
import { ROLE_LABELS } from "@/lib/domain/status";
import { ROLES } from "@/lib/domain/types";
import { OneTimeSecret } from "./one-time-secret";
import { buttonClass, Field, Flash, inputClass, Select } from "./ui";

type Action = (
	state: CreateAgentState,
	form: FormData,
) => Promise<CreateAgentState>;

/** Creates an agent token and shows it exactly once. */
export function CreateAgentForm({ action }: { action: Action }) {
	const [state, formAction, pending] = useActionState(action, {});
	return (
		<div className="space-y-4">
			{state.token && (
				<OneTimeSecret
					key={state.token}
					label={`Token for ${state.name} — copy it now, it won't be shown again.`}
					value={state.token}
				/>
			)}
			<Flash error={state.error} />
			<form action={formAction} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Name" htmlFor="agent-name">
						<input
							id="agent-name"
							name="name"
							required
							placeholder="On-call agent"
							className={inputClass}
						/>
					</Field>
					<Field label="Role" htmlFor="agent-role">
						<Select id="agent-role" name="role" defaultValue="editor">
							{ROLES.map((role) => (
								<option key={role} value={role}>
									{ROLE_LABELS[role]}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Description" htmlFor="agent-description">
						<input
							id="agent-description"
							name="description"
							className={inputClass}
						/>
					</Field>
					<Field
						label="Expires in (days)"
						htmlFor="agent-expires"
						hint="Leave empty for no expiry."
					>
						<input
							id="agent-expires"
							name="expiresInDays"
							type="number"
							min={1}
							className={inputClass}
						/>
					</Field>
				</div>
				<button
					type="submit"
					disabled={pending}
					className={buttonClass.primary}
				>
					{pending ? "Creating…" : "Create token"}
				</button>
			</form>
		</div>
	);
}
