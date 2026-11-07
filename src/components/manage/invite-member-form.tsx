"use client";

import { useActionState } from "react";
import type { InviteMemberState } from "@/app/manage/actions";
import { SubmitButton } from "@/components/submit-button";
import { ROLE_LABELS } from "@/lib/domain/status";
import { ROLES } from "@/lib/domain/types";
import { OneTimeSecret } from "./one-time-secret";
import { buttonClass, Field, Flash, inputClass, Select } from "./ui";

type Action = (
	state: InviteMemberState,
	form: FormData,
) => Promise<InviteMemberState>;

/** Creates an invite and shows its link exactly once. */
export function InviteMemberForm({ action }: { action: Action }) {
	const [state, formAction] = useActionState(action, {});
	return (
		<div className="space-y-4">
			{state.url && (
				<OneTimeSecret
					key={state.url}
					label={`Invite link for ${state.email}. Copy it now. You cannot see it again.`}
					value={state.url}
				/>
			)}
			<Flash error={state.error} />
			<form action={formAction} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Email" htmlFor="invite-email">
						<input
							id="invite-email"
							name="email"
							type="email"
							required
							className={inputClass}
						/>
					</Field>
					<Field label="Role" htmlFor="invite-role">
						<Select id="invite-role" name="role" defaultValue="editor">
							{ROLES.map((role) => (
								<option key={role} value={role}>
									{ROLE_LABELS[role]}
								</option>
							))}
						</Select>
					</Field>
				</div>
				<SubmitButton className={buttonClass.primary}>
					Create invite link
				</SubmitButton>
			</form>
		</div>
	);
}
