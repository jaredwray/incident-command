import type { Metadata } from "next";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { CopyInviteLinkButton } from "@/components/manage/copy-invite-link-button";
import { InviteMemberForm } from "@/components/manage/invite-member-form";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { buttonClass, Card, Select } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain/status";
import { ROLES } from "@/lib/domain/types";
import { INVITE_TTL_DAYS } from "@/lib/services/members";
import {
	deleteMemberAction,
	inviteMemberAction,
	renewInviteLinkAction,
	revokeInviteAction,
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
	const [settings, members, invites] = await Promise.all([
		services.settings.get(),
		services.members.list(actor),
		services.members.listInvites(actor),
	]);
	const now = new Date().toISOString();
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
			{invites.length > 0 && (
				<Card
					title="Open invites"
					description="Copy link makes a new link for the invite. The old link stops working."
				>
					<ul className="divide-y divide-border">
						{invites.map((invite) => (
							<li
								key={invite.id}
								className="flex flex-wrap items-center justify-between gap-3 py-3"
							>
								<div>
									<p className="font-medium">{invite.email}</p>
									<p className="text-xs text-muted">
										{ROLE_LABELS[invite.role]} · Invited by{" "}
										{invite.invitedBy.name} ·{" "}
										{invite.expiresAt > now ? (
											<>
												Expires <LocalTime iso={invite.expiresAt} />
											</>
										) : (
											<span className="text-major">Expired</span>
										)}
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									{invite.expiresAt > now && (
										<CopyInviteLinkButton
											action={renewInviteLinkAction.bind(null, invite.id)}
										/>
									)}
									<form action={revokeInviteAction}>
										<input type="hidden" name="id" value={invite.id} />
										<ConfirmButton
											message={`Revoke the invite for ${invite.email}? The link will stop working.`}
										>
											Revoke
										</ConfirmButton>
									</form>
								</div>
							</li>
						))}
					</ul>
				</Card>
			)}
			<Card
				title="Invite a member"
				description={`Send the link to the new member. They use it to create their account. The link works one time and expires after ${INVITE_TTL_DAYS} days.`}
			>
				<InviteMemberForm action={inviteMemberAction} />
			</Card>
		</ManageShell>
	);
}
