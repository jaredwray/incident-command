import { apiFailure, unauthorized } from "@/lib/api";
import { getMemberForApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The queue progress for one incident. The dashboard banner polls this route. */
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
		const progress = await member.services.notificationJobs.incidentProgress(
			member.actor,
			id,
		);
		return Response.json(
			{ progress: progress ?? null },
			{ headers: { "cache-control": "no-store" } },
		);
	} catch (error) {
		return apiFailure(error);
	}
}
