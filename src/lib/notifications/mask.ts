import type { NotificationChannel } from "../domain/types";

/**
 * Hides an address. The result is safe to store and to show.
 * The function does not throw.
 */
export function maskTarget(
	channel: NotificationChannel,
	target: string,
): string {
	if (channel === "email") {
		const at = target.indexOf("@");
		if (at <= 0) {
			return "***";
		}
		return `${target[0]}***${target.slice(at)}`;
	}
	if (channel === "sms") {
		const digits = target.replace(/\D/g, "");
		const tail = digits.slice(-4);
		return tail.length > 0 ? `***${tail}` : "***";
	}
	try {
		const host = new URL(target).host;
		return host.length > 0 ? host : "***";
	} catch {
		return "***";
	}
}
