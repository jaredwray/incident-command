import type { Metadata } from "next";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	Field,
	inputClass,
	Select,
} from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain/status";
import { ROLES } from "@/lib/domain/types";
import {
	createMemberAction,
	deleteMemberAction,
	updateMemberAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members" };

const ROLE_HELP =
	"Viewers can read, editors manage incidents and services, admins manage everything.";

export default async function MembersPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, actor, services, app } = await requireMember("admin");
	const [settings, members] = await Promise.all([
		services.settings.get(),
		services.members.list(actor),
	]);
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="members"
			title="Members"
			flash={flash}
			health={app.store.health}
		>
			<Card title="Team" description={ROLE_HELP}>
				<ul className="divide-y divide-border">
					{members.map((person) => (
						<li
							key={person.id}
							className="flex flex-wrap items-center justify-between gap-3 py-3"
						>
							<div>
								<p className="font-medium">
									{person.name}
									{person.id === member.id && (
										<span className="ml-2 text-xs text-muted">(you)</span>
									)}
								</p>
								<p className="text-xs text-muted">
									{person.email} ·{" "}
									{person.lastLoginAt ? (
										<>
											Last sign-in <LocalTime iso={person.lastLoginAt} />
										</>
									) : (
										"Never signed in"
									)}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<form
									action={updateMemberAction}
									className="flex items-center gap-2"
								>
									<input type="hidden" name="id" value={person.id} />
									<label htmlFor={`role-${person.id}`} className="sr-only">
										Role for {person.name}
									</label>
									<Select
										id={`role-${person.id}`}
										name="role"
										defaultValue={person.role}
									>
										{ROLES.map((role) => (
											<option key={role} value={role}>
												{ROLE_LABELS[role]}
											</option>
										))}
									</Select>
									<SubmitButton className={buttonClass.secondary}>
										Save
									</SubmitButton>
								</form>
								<form action={deleteMemberAction}>
									<input type="hidden" name="id" value={person.id} />
									<ConfirmButton message={`Remove ${person.name}?`}>
										Remove
									</ConfirmButton>
								</form>
							</div>
						</li>
					))}
				</ul>
			</Card>
			<Card
				title="Add a member"
				description="Share the temporary password securely; they can change it from their account page."
			>
				<form action={createMemberAction} className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name" htmlFor="member-name">
							<input
								id="member-name"
								name="name"
								required
								className={inputClass}
							/>
						</Field>
						<Field label="Email" htmlFor="member-email">
							<input
								id="member-email"
								name="email"
								type="email"
								required
								className={inputClass}
							/>
						</Field>
						<Field label="Role" htmlFor="member-role">
							<Select id="member-role" name="role" defaultValue="editor">
								{ROLES.map((role) => (
									<option key={role} value={role}>
										{ROLE_LABELS[role]}
									</option>
								))}
							</Select>
						</Field>
						<Field
							label="Temporary password"
							htmlFor="member-password"
							hint="At least 8 characters."
						>
							<input
								id="member-password"
								name="password"
								type="password"
								minLength={8}
								required
								className={inputClass}
							/>
						</Field>
					</div>
					<SubmitButton className={buttonClass.primary}>
						Add member
					</SubmitButton>
				</form>
			</Card>
		</ManageShell>
	);
}
