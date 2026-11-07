import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Services } from "../services";
import { createMcpServer } from "./server";

function jsonRpcError(
	status: number,
	message: string,
	headers: Record<string, string> = {},
) {
	return Response.json(
		{ jsonrpc: "2.0", error: { code: -32000, message }, id: null },
		{ status, headers },
	);
}

export function bearerToken(header: string | null): string | undefined {
	const match = header?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim();
}

/**
 * Handles a Streamable HTTP MCP request in stateless mode: every POST is
 * authenticated with an agent bearer token and served by a fresh server.
 */
export async function handleMcpRequest(
	request: Request,
	services: Services,
): Promise<Response> {
	if (request.method !== "POST") {
		return jsonRpcError(
			405,
			"Method not allowed. This server is stateless; use POST.",
			{
				allow: "POST",
			},
		);
	}
	const actor = await services.agents.authenticate(
		bearerToken(request.headers.get("authorization")),
	);
	if (!actor) {
		return jsonRpcError(401, "Missing or invalid agent token", {
			"www-authenticate": 'Bearer realm="incident-command"',
		});
	}
	const server = createMcpServer(services, actor, new URL(request.url).origin);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close();
	}
}
