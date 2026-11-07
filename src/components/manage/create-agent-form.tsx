"use client";

import { useActionState, useState } from "react";
import type { CreateAgentState } from "@/app/manage/actions";
import { ROLE_LABELS } from "@/lib/domain/status";
import { ROLES } from "@/lib/domain/types";
import { buttonClass, Field, inputClass, Select } from "./ui";

type Action = (
	state: CreateAgentState,
	form: FormData,
) => Promise<CreateAgentState>;

/** Creates an agent token and shows it exactly once. */
export function CreateAgentForm({ action }: { action: Action }) {
	const [state, formAction, pending] = useActionState(action, {});
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(state.token as string);
		setCopied(true);
	};
	return (
		<div className="space-y-4">
			{state.token && (
				<div
					role="status"
					className="space-y-2 rounded-lg border border-operational/40 bg-operational/10 p-4"
				>
					<p className="text-sm font-medium">
						Token for {state.name} — copy it now, it won't be shown again.
					</p>
					<div className="flex gap-2">
						<code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs">
							{state.token}
						</code>
						<button
							type="button"
							onClick={copy}
							className={buttonClass.secondary}
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				</div>
			)}
			{state.error && (
				<p
					role="alert"
					className="rounded-lg border border-major/40 bg-major/10 px-4 py-3 text-sm text-major"
				>
					{state.error}
				</p>
			)}
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
