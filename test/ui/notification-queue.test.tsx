import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { act, Component, type ReactNode } from "react";
import DraftPage from "@/app/manage/(portal)/drafts/[id]/page";
import IncidentPage from "@/app/manage/(portal)/incidents/[id]/page";
import NewIncidentPage from "@/app/manage/(portal)/incidents/new/page";
import NotificationsSettingsPage from "@/app/manage/(portal)/settings/notifications/page";
import {
	approveDraftWithProgressAction,
	createIncidentWithProgressAction,
	postIncidentUpdateAction,
	postIncidentUpdateWithProgressAction,
	updateNotificationQueueAction,
} from "@/app/manage/actions";
import { GET as incidentRoute } from "@/app/manage/progress/incidents/[id]/route";
import { GET as jobRoute } from "@/app/manage/progress/jobs/[id]/route";
import { ProgressBar } from "@/components/manage/progress-bar";
import { QueueSettingsCard } from "@/components/manage/queue-settings";
import { SendButton } from "@/components/manage/send-button";
import { SendProgressBanner } from "@/components/manage/send-progress-banner";
import type {
	NotificationJobView,
	NotificationProgress,
} from "@/lib/domain/types";
import { NotificationQueue } from "@/lib/notifications/queue";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { agentActor } from "../helpers";
import {
	expectFlashRedirect,
	form,
	params,
	redirectOf,
	setupApp,
	signIn,
} from "./app";

const KEY = "k".repeat(32);
const page = (value: Record<string, string> = {}) => ({
	searchParams: params(value),
});

/** Receives a render failure, as the error boundary of a page does. */
class PageBoundary extends Component<
	{ children: ReactNode; onError: (error: unknown) => void },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown) {
		this.props.onError(error);
	}

	render() {
		return this.state.failed ? null : this.props.children;
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const activeProgress: NotificationProgress = {
	total: 2,
	done: 0,
	sent: 0,
	failed: 0,
	active: 1,
	fallback: false,
};

function jobView(
	overrides: Partial<NotificationJobView> = {},
): NotificationJobView {
	return {
		id: "njb_1",
		incidentId: "inc_1",
		state: "done",
		total: 1,
		sent: 1,
		failed: 0,
		queued: false,
		truncated: false,
		deliveries: [
			{
				id: "ndl_1",
				channel: "webhook",
				order: 0,
				state: "sent",
				label: "hooks.example.com",
			},
		],
		...overrides,
	};
}

async function callJob(id: string): Promise<Response> {
	return jobRoute(new Request("http://localhost/job"), {
		params: params({ id }),
	});
}

async function callIncident(id: string): Promise<Response> {
	return incidentRoute(new Request("http://localhost/incident"), {
		params: params({ id }),
	});
}

describe("notification progress routes", () => {
	it("rejects a visitor and a viewer and returns a job to an editor", async () => {
		const { app, services } = await setupApp();
		expect((await callJob("njb_1")).status).toBe(401);
		expect((await callIncident("inc_1")).status).toBe(401);
		await signIn(app, "editor");
		expect((await callJob("njb_missing")).status).toBe(404);
		await signIn(app, "editor", { twoFactor: false });
		expect((await callJob("njb_1")).status).toBe(401);

		await services.settings.update(SYSTEM_ACTOR, { requireTwoFactor: false });
		await signIn(app, "viewer", { twoFactor: false });
		expect((await callJob("njb_1")).status).toBe(403);
		expect((await callIncident("inc_1")).status).toBe(403);

		const { actor } = await signIn(app, "editor", { twoFactor: false });
		expect((await callJob("njb_missing")).status).toBe(404);
		await services.subscribers.addWebhook(SYSTEM_ACTOR, {
			url: "https://hooks.example.com/a",
		});
		const incident = await services.incidents.create(
			actor,
			{ title: "API errors", message: "Looking", notify: true },
			{ jobId: "njb_route" },
		);
		const response = await callJob("njb_route");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = (await response.json()) as { job: NotificationJobView };
		expect(body.job.sent).toBe(1);
		expect(body.job.deliveries[0]?.label).toBeUndefined();

		const empty = await callIncident(incident.id);
		expect(await empty.json()).toEqual({ progress: null });

		const { actor: admin } = await signIn(app, "admin", { twoFactor: false });
		const labeled = (await (await callJob("njb_route")).json()) as {
			job: NotificationJobView;
		};
		expect(labeled.job.deliveries[0]?.label).toBe("hooks.example.com");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		const enqueue = vi
			.spyOn(NotificationQueue.prototype, "enqueue")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(admin, {
			revision: 0,
			provider: "redis",
		});
		const queued = await services.incidents.create(
			admin,
			{ title: "Queued", message: "Looking", notify: true },
			{ jobId: "njb_queued" },
		);
		const progress = (await (await callIncident(queued.id)).json()) as {
			progress: NotificationProgress;
		};
		expect(progress.progress).toMatchObject({ sent: 0, active: 1 });
		open.mockRestore();
		enqueue.mockRestore();
	});
});

describe("queue send actions", () => {
	it("returns the job when no queue is saved and redirects when a queue is saved", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "editor");
		await services.subscribers.addWebhook(SYSTEM_ACTOR, {
			url: "https://hooks.example.com/a",
		});
		const declared = await createIncidentWithProgressAction(
			form({ title: "API errors", message: "Looking", notify: "on" }),
		);
		expect(declared?.jobId).toMatch(/^njb_/);
		expect(declared?.href).toContain("notice=incident_declared");

		const quiet = await redirectOf(
			createIncidentWithProgressAction(
				form({ title: "Quiet", message: "Looking" }),
			),
		);
		expect(quiet).toContain("notice=incident_declared");

		const incident = await services.incidents.create(actor, {
			title: "Open",
			message: "Looking",
			notify: false,
		});
		const posted = await postIncidentUpdateWithProgressAction(
			form({
				id: incident.id,
				message: "Update",
				notify: "on",
				tab: "posts",
			}),
		);
		expect(posted?.href).toContain("tab=posts");

		const draft = await services.drafts.create(agentActor(), {
			title: "Drafted",
			message: "x",
		});
		const approved = await approveDraftWithProgressAction(
			form({
				id: draft.id,
				title: "Drafted",
				message: "Cause found",
				notify: "on",
			}),
		);
		expect(approved?.href).toContain("notice=draft_approved");

		const { actor: admin } = await signIn(app, "admin");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(admin, {
			revision: 0,
			provider: "redis",
		});
		const queued = await redirectOf(
			postIncidentUpdateAction(
				form({
					id: incident.id,
					message: "Queued",
					notify: "on",
					tab: "posts",
				}),
			),
		);
		open.mockRestore();
		expectFlashRedirect(
			queued,
			`/manage/incidents/${incident.id}`,
			"notice",
			"The notifications are in the queue.",
		);
		expect(new URL(queued, "http://localhost").searchParams.get("tab")).toBe(
			null,
		);
	});

	it("keeps a send on the incident list when the id is not an incident id", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "editor");
		await services.subscribers.addWebhook(SYSTEM_ACTOR, {
			url: "https://hooks.example.com/a",
		});
		const odd = await services.incidents.create(
			actor,
			{ title: "Odd", message: "Looking", notify: false },
			{ id: "https://evil.example" },
		);
		const direct = await redirectOf(
			postIncidentUpdateAction(
				form({ id: odd.id, message: "More", notify: "on" }),
			),
		);
		expect(new URL(direct, "http://localhost").pathname).toBe(
			"/manage/incidents",
		);
		expect(direct).not.toContain("evil.example");

		const modal = await postIncidentUpdateWithProgressAction(
			form({ id: odd.id, message: "Again", notify: "on" }),
		);
		expect(modal?.href).toBe("/manage/incidents?notice=update_posted");

		const quiet = await redirectOf(
			postIncidentUpdateWithProgressAction(
				form({ id: odd.id, message: "Quiet" }),
			),
		);
		expect(new URL(quiet, "http://localhost").pathname).toBe(
			"/manage/incidents",
		);
		expect(quiet).not.toContain("evil.example");

		const { actor: admin } = await signIn(app, "admin");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(admin, {
			revision: 0,
			provider: "redis",
		});
		const queued = await redirectOf(
			postIncidentUpdateAction(
				form({ id: odd.id, message: "Queued", notify: "on" }),
			),
		);
		open.mockRestore();
		expectFlashRedirect(
			queued,
			"/manage/incidents",
			"notice",
			"The notifications are in the queue.",
		);
		expect(queued).not.toContain("evil.example");
	});

	it("saves the queue and reports a bad URI", async () => {
		const { app } = await setupApp({ ENCRYPTION_KEY: KEY });
		await signIn(app, "admin");
		expectFlashRedirect(
			await redirectOf(
				updateNotificationQueueAction(
					form({ revision: "0", provider: "redis" }),
				),
			),
			"/manage/settings/notifications",
			"error",
			"The settings are saved, but the server cannot connect to the queue. The server sends notifications without the queue until the connection works.",
		);
		expectFlashRedirect(
			await redirectOf(
				updateNotificationQueueAction(
					form({ revision: "1", provider: "redis", uri: "http://nope" }),
				),
			),
			"/manage/settings/notifications",
			"error",
			"The connection URI is not correct for this provider.",
		);
		expectFlashRedirect(
			await redirectOf(
				updateNotificationQueueAction(
					form({ revision: "1", provider: "redis", uri: "redis://localhost" }),
				),
			),
			"/manage/settings/notifications",
			"error",
			"The settings are saved, but the server cannot connect to the queue. The server sends notifications without the queue until the connection works.",
		);
		const { app: editorApp } = await setupApp();
		await signIn(editorApp, "editor");
		const refused = await redirectOf(
			updateNotificationQueueAction(form({ revision: "0", provider: "redis" })),
		);
		expect(new URL(refused, "http://localhost").pathname).toBe("/manage");

		const { app: clearApp } = await setupApp({ ENCRYPTION_KEY: KEY });
		await signIn(clearApp, "admin");
		expectFlashRedirect(
			await redirectOf(
				updateNotificationQueueAction(
					form({ revision: "0", provider: "none" }),
				),
			),
			"/manage/settings/notifications",
			"notice",
			"Queue saved",
		);
		expectFlashRedirect(
			await redirectOf(updateNotificationQueueAction(form({ revision: "1" }))),
			"/manage/settings/notifications",
			"notice",
			"Queue saved",
		);
		const missing = await redirectOf(
			updateNotificationQueueAction(form({ provider: "redis" })),
		);
		expect(
			new URL(missing, "http://localhost").searchParams.get("error"),
		).toBeTruthy();
	});
});

describe("send status window", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("opens before the send returns and shows each row", async () => {
		let resolve: (value: { jobId: string; href: string }) => void = () => {};
		const action = vi.fn(
			() =>
				new Promise<{ jobId: string; href: string }>((done) => {
					resolve = done;
				}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				json({
					job: jobView({
						state: "done",
						failed: 1,
						sent: 0,
						truncated: true,
						deliveries: [
							{ id: "ndl_1", channel: "webhook", order: 0, state: "failed" },
						],
					}),
				}),
			),
		);
		render(
			<form onSubmit={(event) => event.preventDefault()}>
				<button type="submit">Other</button>
				<SendButton modal progressAction={action} className="bg-brand">
					Send
				</SendButton>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Other" }));
		expect(action).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		const dialog = document.querySelector("dialog");
		expect(dialog?.open).toBe(true);
		expect(
			screen.getByText("The server prepares the notifications."),
		).toBeInTheDocument();
		const cancel = new Event("cancel", { cancelable: true });
		dialog?.dispatchEvent(cancel);
		expect(cancel.defaultPrevented).toBe(true);
		await act(async () => {
			resolve({ jobId: "njb_1", href: "/manage/incidents/inc_1" });
		});
		expect(await screen.findByText("Failed")).toBeInTheDocument();
		expect(screen.getByText("Webhook 1")).toBeInTheDocument();
		expect(
			screen.getByText("The list shows the first 200 notifications."),
		).toBeInTheDocument();
		expect(screen.getByText(/Some notifications failed/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
			"href",
			"/manage/incidents/inc_1",
		);
	});

	it("closes when there is no job", async () => {
		const empty = vi.fn(async () => undefined);
		render(
			<form onSubmit={(event) => event.preventDefault()}>
				<SendButton modal progressAction={empty} className="bg-brand">
					Send
				</SendButton>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(document.querySelector("dialog")?.open).toBe(true);
		await waitFor(() =>
			expect(document.querySelector("dialog")?.open).toBe(false),
		);
		expect(
			screen.queryByText("The server prepares the notifications."),
		).not.toBeInTheDocument();
	});

	it("gives a failed send to the page and does not open a location", async () => {
		const assign = vi.fn();
		const location = window.location;
		Object.defineProperty(window, "location", {
			configurable: true,
			value: { ...location, assign },
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		// Next.js rejects the action with this error after it opens the page.
		const redirected = Object.assign(new Error("NEXT_REDIRECT"), {
			digest: "NEXT_REDIRECT;push;/manage/incidents/x?error=validation;307;",
		});
		const caught = vi.fn();
		render(
			<PageBoundary onError={caught}>
				<form onSubmit={(event) => event.preventDefault()}>
					<SendButton
						modal
						progressAction={vi.fn(async () => {
							throw redirected;
						})}
						className="bg-brand"
					>
						Send
					</SendButton>
				</form>
			</PageBoundary>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(caught).toHaveBeenCalledWith(redirected));
		expect(document.querySelector("dialog")).toBeNull();
		expect(assign).not.toHaveBeenCalled();
		log.mockRestore();
		Object.defineProperty(window, "location", {
			configurable: true,
			value: location,
		});
	});

	it("stops the poll on an HTTP error and retries a network error", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 500))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(json({ job: jobView() }));
		vi.stubGlobal("fetch", fetchMock);
		const action = vi.fn(async () => ({
			jobId: "njb_1",
			href: "/manage/incidents/inc_1",
		}));
		const view = render(
			<form onSubmit={(event) => event.preventDefault()}>
				<SendButton modal progressAction={action} className="bg-brand">
					Send
				</SendButton>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The page cannot read the status.",
		);
		expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
			"href",
			"/manage/incidents/inc_1",
		);
		const stopped = fetchMock.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});
		expect(fetchMock.mock.calls.length).toBe(stopped);
		view.unmount();

		render(
			<form onSubmit={(event) => event.preventDefault()}>
				<SendButton modal progressAction={action} className="bg-brand">
					Send
				</SendButton>
			</form>,
		);
		fireEvent.click(
			screen.getAllByRole("button", { name: "Send" }).at(-1) as HTMLElement,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		vi.useRealTimers();
	});

	it("submits the form action when a queue is saved", () => {
		render(
			<form>
				<SendButton modal={false} progressAction={vi.fn()} className="bg-brand">
					Post update
				</SendButton>
			</form>,
		);
		expect(document.querySelector("dialog")).toBeNull();
		expect(screen.getByRole("button", { name: "Post update" })).toHaveAttribute(
			"type",
			"submit",
		);
	});
});

describe("queue progress banner", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("updates the bar until the queue is done", async () => {
		vi.useFakeTimers();
		const done: NotificationProgress = {
			total: 2,
			done: 2,
			sent: 1,
			failed: 1,
			active: 0,
			fallback: true,
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				json({ progress: { ...activeProgress, done: 1, sent: 1 } }),
			)
			.mockResolvedValueOnce(json({ progress: done }));
		vi.stubGlobal("fetch", fetchMock);
		render(<SendProgressBanner incidentId="inc_1" initial={activeProgress} />);
		expect(
			screen.getByText("The queue sends the notifications."),
		).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
		await act(async () => {
			await Promise.resolve();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(screen.getByText(/Some notifications failed/)).toBeInTheDocument();
		expect(screen.getByText(/The queue was not available/)).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"2",
		);
		const calls = fetchMock.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(fetchMock.mock.calls.length).toBe(calls);
	});

	it("starts again when the dashboard gives the numbers of a new send", async () => {
		vi.useFakeTimers();
		const first: NotificationProgress = {
			...activeProgress,
			done: 2,
			sent: 2,
			active: 0,
		};
		const second: NotificationProgress = {
			...first,
			total: 4,
			active: 1,
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({ progress: first }))
			.mockResolvedValueOnce(json({ progress: second }))
			.mockResolvedValueOnce(
				json({ progress: { ...second, done: 4, sent: 4, active: 0 } }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const view = render(
			<SendProgressBanner incidentId="inc_1" initial={activeProgress} />,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(screen.getByText("Notifications complete: 2 of 2.")).toBeVisible();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		view.rerender(<SendProgressBanner incidentId="inc_1" initial={second} />);
		expect(screen.getByText("Notifications complete: 2 of 4.")).toBeVisible();
		expect(
			screen.getByText("The queue sends the notifications."),
		).toBeVisible();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(screen.getByText("Notifications complete: 4 of 4.")).toBeVisible();
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("stops when the progress route fails and retries a network error", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json({}, 500))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(
				json({
					progress: { ...activeProgress, active: 0, done: 2, sent: 2 },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const first = render(
			<SendProgressBanner incidentId="inc_1" initial={activeProgress} />,
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.getByRole("alert")).toHaveTextContent("Reload the page.");
		first.unmount();

		render(<SendProgressBanner incidentId="inc_2" initial={activeProgress} />);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(screen.getByText(/All notifications were sent/)).toBeInTheDocument();
	});

	it("ignores a response after the banner is gone", async () => {
		let settle: (response: Response) => void = () => {};
		let fail: (error: Error) => void = () => {};
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						settle = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<Response>((_resolve, reject) => {
						fail = reject;
					}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const first = render(
			<SendProgressBanner incidentId="inc_1" initial={activeProgress} />,
		);
		await act(async () => {
			await Promise.resolve();
		});
		first.unmount();
		await act(async () => {
			settle(json({ progress: activeProgress }));
		});
		const second = render(
			<SendProgressBanner incidentId="inc_2" initial={activeProgress} />,
		);
		await act(async () => {
			await Promise.resolve();
		});
		second.unmount();
		await act(async () => {
			fail(new Error("aborted"));
		});
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("shows each stage of a send", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					job: jobView({
						state: "active",
						sent: 0,
						failed: 0,
						deliveries: [
							{ id: "ndl_1", channel: "email", order: 0, state: "pending" },
						],
					}),
				}),
			)
			.mockResolvedValueOnce(json({ job: jobView() }));
		vi.stubGlobal("fetch", fetchMock);
		const action = vi.fn(async () => ({
			jobId: "njb_1",
			href: "/manage/incidents/inc_1",
		}));
		render(
			<form onSubmit={(event) => event.preventDefault()}>
				<SendButton modal progressAction={action} className="bg-brand">
					Send
				</SendButton>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.getByText("Waiting")).toBeInTheDocument();
		expect(screen.getByText("Email 1")).toBeInTheDocument();
		expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(
			screen.getByText("All notifications were sent."),
		).toBeInTheDocument();
	});

	it("shows an empty bar when the total is zero", () => {
		render(<ProgressBar value={0} max={0} tone="operational" />);
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
	});
});

describe("queue settings card", () => {
	it("shows one choice and a disabled URI field without a key", () => {
		render(
			<QueueSettingsCard
				queue={{ hasUri: false, revision: 0 }}
				canStoreSecrets={false}
			/>,
		);
		expect(screen.getByRole("radio", { name: /No queue/ })).toBeChecked();
		expect(screen.getAllByRole("radio")).toHaveLength(4);
		fireEvent.click(screen.getByRole("radio", { name: /Redis/ }));
		expect(screen.getByLabelText("Connection URI")).toBeDisabled();
		expect(screen.getByText(/ENCRYPTION_KEY/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("radio", { name: /No queue/ }));
		expect(screen.queryByLabelText("Connection URI")).not.toBeInTheDocument();
	});

	it("keeps a saved URI off the page", () => {
		const { container } = render(
			<QueueSettingsCard
				queue={{ provider: "redis", hasUri: true, revision: 2 }}
				canStoreSecrets
			/>,
		);
		expect(screen.getByRole("radio", { name: /Redis/ })).toBeChecked();
		expect(screen.getByLabelText("Connection URI")).toHaveValue("");
		expect(
			screen.getByText("Saved. Leave empty to keep it."),
		).toBeInTheDocument();
		expect(container.innerHTML).not.toContain("secret");
		fireEvent.click(screen.getByRole("radio", { name: /NATS/ }));
		expect(
			screen.getByText(/Leave empty to use localhost:4222/),
		).toBeInTheDocument();
	});
});

describe("queue pages", () => {
	it("shows the queue card and hides the URI", async () => {
		const { app, services } = await setupApp({ ENCRYPTION_KEY: KEY });
		const { actor } = await signIn(app, "admin");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(actor, {
			revision: 0,
			provider: "redis",
		});
		open.mockRestore();
		const { container } = render(await NotificationsSettingsPage(page()));
		const queue = screen
			.getByRole("heading", { name: "Queue" })
			.closest("section");
		expect(queue).not.toBeNull();
		expect(within(queue as HTMLElement).getAllByRole("radio")).toHaveLength(4);
		expect(screen.getByRole("radio", { name: /Redis/ })).toBeChecked();
		expect(container.innerHTML).not.toContain("secret");
	});

	it("shows a status window when no queue is saved", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		render(await NewIncidentPage(page()));
		expect(document.querySelector("dialog")).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Declare incident" }),
		).toBeInTheDocument();
	});

	it("shows the banner on the incident dashboard only", async () => {
		const { app, services, notifier } = await setupApp();
		const { actor } = await signIn(app, "editor");
		await services.subscribers.addWebhook(SYSTEM_ACTOR, {
			url: "https://hooks.example.com/a",
		});
		const { actor: admin } = await signIn(app, "admin");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(admin, {
			revision: 0,
			provider: "redis",
		});
		await signIn(app, "editor");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				json({
					progress: {
						total: 1,
						done: 0,
						sent: 0,
						failed: 0,
						active: 1,
						fallback: false,
					},
				}),
			),
		);
		const release = notifier.hold();
		const incident = await services.incidents.create(
			actor,
			{ title: "API errors", message: "Looking", notify: true },
			{ jobId: "njb_banner" },
		);
		open.mockRestore();
		const dashboard = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.getByText("The queue sends the notifications."),
		).toBeInTheDocument();
		dashboard.unmount();
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "posts" }),
			}),
		);
		expect(
			screen.queryByText("The queue sends the notifications."),
		).not.toBeInTheDocument();
		release();

		await signIn(app, "viewer");
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.queryByText("The queue sends the notifications."),
		).not.toBeInTheDocument();
		vi.unstubAllGlobals();
	});

	it("shows the status window on a draft when no queue is saved", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const draft = await services.drafts.create(agentActor(), {
			title: "API errors",
			message: "x",
		});
		const first = render(
			await DraftPage({
				params: params({ id: draft.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.getByRole("button", { name: "Approve and send" }),
		).toBeInTheDocument();
		expect(document.querySelector("dialog")).not.toBeNull();
		first.unmount();

		const { actor } = await signIn(app, "admin");
		const open = vi
			.spyOn(NotificationQueue.prototype, "open")
			.mockResolvedValue("ok");
		await services.notificationQueue.update(actor, {
			revision: 0,
			provider: "redis",
		});
		open.mockRestore();
		await signIn(app, "editor");
		render(
			await DraftPage({
				params: params({ id: draft.id }),
				searchParams: params({}),
			}),
		);
		expect(document.querySelector("dialog")).toBeNull();
	});
});
