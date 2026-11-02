import { getApp } from "@/lib/app";
import { handleMcpRequest } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

async function handler(request: Request): Promise<Response> {
	const { services } = await getApp();
	return handleMcpRequest(request, services);
}

export { handler as DELETE, handler as GET, handler as POST };
