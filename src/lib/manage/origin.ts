import { headers } from "next/headers";

/** The public origin of this deployment: the configured URL, else the request host. */
export async function publicOrigin(
	configured: string | undefined,
): Promise<string> {
	if (configured) {
		return configured.replace(/\/+$/, "");
	}
	const list = await headers();
	const host =
		list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
	const proto =
		list.get("x-forwarded-proto") ??
		(host.startsWith("localhost") ? "http" : "https");
	return `${proto}://${host}`;
}
