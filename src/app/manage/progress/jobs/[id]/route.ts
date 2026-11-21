import { apiFailure, unauthorized } from "@/lib/api";
import { getMemberForApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The status of one notification job. The status window polls this route. */
export async function GET(
	_request: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	try {
		const member = await getMemberForApi();
		if (!member) {
			return unauthorized();
		}
		const { id } = await context.params;
		const job = await member.services.notificationJobs.detail(member.actor, id);
		return Response.json({ job }, { headers: { "cache-control": "no-store" } });
	} catch (error) {
		return apiFailure(error);
	}
}
