import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusIcon } from "@/components/icons";
import { AddSubscriberForm } from "@/components/manage/add-subscriber-form";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { CopyInviteLinkButton } from "@/components/manage/copy-invite-link-button";
import { CreateAgentForm } from "@/components/manage/create-agent-form";
import { statusesFor } from "@/components/manage/incident-fields";
import { InviteMemberForm } from "@/components/manage/invite-member-form";
import { eventColorStatus, StatusBadge } from "@/components/status/badges";
import { IncidentList } from "@/components/status/recent-incidents";
import { UptimeBars } from "@/components/status/uptime-bars";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/time";

describe("LocalTime", () => {
	it("switches from UTC to local time after mount", async () => {
		render(<LocalTime iso="2026-11-02T12:00:00.000Z" className="x" />);
		const time = document.querySelector("time");
		expect(time).toHaveAttribute("datetime", "2026-11-02T12:00:00.000Z");
		await waitFor(() => expect(time?.textContent).not.toContain("UTC,"));
	});
});

describe("ConfirmButton", () => {
	it("only submits when confirmed", () => {
		const onSubmit = vi.fn((event: Event) => event.preventDefault());
		render(
			<form onSubmit={onSubmit as never}>
				<ConfirmButton message="Sure?">Delete</ConfirmButton>
			</form>,
		);
		const confirm = vi
			.spyOn(window, "confirm")
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true);
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onSubmit).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(confirm).toHaveBeenCalledWith("Sure?");
	});
});

describe("SubmitButton", () => {
	it("is disabled and busy while the action of its form runs", async () => {
		let finish = () => {};
		const action = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		render(
			<form action={action}>
				<SubmitButton className="button">Add service</SubmitButton>
			</form>,
		);
		const button = screen.getByRole("button", { name: "Add service" });
		expect(button).toBeEnabled();
		expect(button.querySelector('[aria-hidden="true"]')).toBeNull();

		fireEvent.click(button);
		await waitFor(() => expect(button).toBeDisabled());
		expect(button).toHaveAttribute("aria-busy", "true");
		expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
		expect(action).toHaveBeenCalledTimes(1);

		await act(async () => finish());
		await waitFor(() => expect(button).toBeEnabled());
		expect(button).toHaveAttribute("aria-busy", "false");
		expect(button.querySelector('[aria-hidden="true"]')).toBeNull();
	});
});

describe("CreateAgentForm", () => {
	it("shows the token once and copies it", async () => {
		const action = vi.fn(async () => ({ token: "icmd_secret", name: "Bot" }));
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		render(<CreateAgentForm action={action} />);
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Bot" },
		});
		await act(async () => {
			fireEvent.submit(
				screen
					.getByRole("button", { name: "Create token" })
					.closest("form") as HTMLFormElement,
			);
		});
		expect(await screen.findByText("icmd_secret")).toBeInTheDocument();
		expect(screen.getByText(/Token for Bot/)).toBeInTheDocument();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		});
		expect(writeText).toHaveBeenCalledWith("icmd_secret");
		expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
	});

	it("shows errors and a pending state", async () => {
		let finish: (value: { error: string }) => void = () => {};
		const action = vi.fn(
			() => new Promise<{ error: string }>((resolve) => (finish = resolve)),
		);
		render(<CreateAgentForm action={action} />);
		await act(async () => {
			fireEvent.submit(
				screen
					.getByRole("button", { name: "Create token" })
					.closest("form") as HTMLFormElement,
			);
		});
		expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
		await act(async () => finish({ error: "name: Too small" }));
		expect(screen.getByRole("alert")).toHaveTextContent("name: Too small");
	});
});

describe("AddSubscriberForm", () => {
	it("switches the destination field with the type and drops the old value", async () => {
		const user = userEvent.setup();
		render(<AddSubscriberForm emailEnabled />);
		expect(screen.getByRole("radio", { name: /Webhook/ })).toBeChecked();
		const url = screen.getByLabelText("Webhook URL");
		expect(url).toHaveAttribute("type", "url");
		expect(url).toHaveAttribute(
			"placeholder",
			"https://hooks.slack.com/services/…",
		);
		await user.type(url, "https://hooks.example.com");
		await user.click(screen.getByText("Send updates to an address."));
		expect(screen.getByRole("radio", { name: /Email/ })).toBeChecked();
		expect(screen.queryByLabelText("Webhook URL")).not.toBeInTheDocument();
		const email = screen.getByLabelText("Email address");
		expect(email).toHaveAttribute("type", "email");
		expect(email).toHaveAttribute("placeholder", "ops@example.com");
		expect(email).toHaveValue("");
	});

	it("disables email when it is not configured", () => {
		render(<AddSubscriberForm emailEnabled={false} />);
		const email = screen.getByRole("radio", { name: /Email/ });
		expect(email).toBeDisabled();
		expect(screen.getByText("Not configured")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /Webhook/ })).toBeChecked();
		expect(screen.getByLabelText("Webhook URL")).toHaveAttribute("type", "url");
	});
});

describe("InviteMemberForm", () => {
	it("shows the invite link once, or the error", async () => {
		const url = "https://status.acme.dev/manage/invite?token=abc";
		const action = vi
			.fn()
			.mockResolvedValueOnce({ url, email: "ed@acme.dev" })
			.mockResolvedValueOnce({ error: "email: Invalid email address" });
		render(<InviteMemberForm action={action} />);
		const submit = async () =>
			act(async () => {
				fireEvent.submit(
					screen
						.getByRole("button", { name: "Create invite link" })
						.closest("form") as HTMLFormElement,
				);
			});
		await submit();
		expect(await screen.findByText(url)).toBeInTheDocument();
		expect(screen.getByText(/Invite link for ed@acme.dev/)).toBeInTheDocument();
		await submit();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"email: Invalid email address",
		);
		expect(screen.queryByText(url)).not.toBeInTheDocument();
	});
});

describe("CopyInviteLinkButton", () => {
	it("copies a new link, falls back to a prompt, or shows the error", async () => {
		const url = "https://status.acme.dev/manage/invite?token=abc";
		let finish: (value: { url: string }) => void = () => {};
		const action = vi
			.fn()
			.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
			.mockResolvedValueOnce({ url })
			.mockResolvedValueOnce({ error: "This invite expired or was used." });
		const writeText = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Not allowed"));
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
		render(<CopyInviteLinkButton action={action} />);
		const click = async (name: string) =>
			act(async () => {
				fireEvent.click(screen.getByRole("button", { name }));
			});

		// one click makes one new link, so a second click waits
		await click("Copy link");
		expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
		await act(async () => finish({ url }));
		expect(writeText).toHaveBeenCalledWith(url);
		expect(screen.getByRole("button", { name: "Copied" })).toBeEnabled();

		await click("Copied");
		expect(prompt).toHaveBeenCalledWith("Copy the invite link.", url);
		expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled();

		await click("Copy link");
		expect(screen.getByRole("alert")).toHaveTextContent(
			"This invite expired or was used.",
		);
		expect(action).toHaveBeenCalledTimes(3);
		prompt.mockRestore();
	});
});

describe("status components", () => {
	it("renders icons for every status", () => {
		const { container } = render(
			<>
				<StatusIcon status="operational" />
				<StatusIcon status="under_maintenance" />
				<StatusIcon status="major_outage" />
				<StatusIcon status="partial_outage" />
			</>,
		);
		expect(container.querySelectorAll("svg")).toHaveLength(4);
	});

	it("colors events by kind, impact and status", () => {
		expect(eventColorStatus("incident", "critical", "resolved")).toBe(
			"operational",
		);
		expect(eventColorStatus("maintenance", "none", "in_progress")).toBe(
			"under_maintenance",
		);
		expect(eventColorStatus("incident", "minor", "investigating")).toBe(
			"degraded_performance",
		);
		render(<StatusBadge status="partial_outage" />);
		expect(screen.getByText("Partial outage")).toBeInTheDocument();
	});

	it("renders uptime bars with tooltips and missing data", () => {
		render(
			<UptimeBars
				days={[
					{ date: "2026-11-01", status: null, uptime: null, incidents: [] },
					{
						date: "2026-11-02",
						status: "major_outage",
						uptime: 0.5,
						incidents: [{ id: "i", title: "Outage", impact: "critical" }],
					},
				]}
			/>,
		);
		expect(
			screen.getByRole("listitem", { name: "Nov 1, 2026: No data" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("listitem", { name: "Nov 2, 2026: Major outage" }),
		).toBeInTheDocument();
		expect(screen.getByText("Outage")).toBeInTheDocument();
		expect(screen.getByText(/50% uptime/)).toBeInTheDocument();
	});

	it("renders incident lists and empty states", () => {
		const { unmount } = render(
			<IncidentList incidents={[]} empty="Nothing here" />,
		);
		expect(screen.getByText("Nothing here")).toBeInTheDocument();
		unmount();
		const base = {
			kind: "incident" as const,
			status: "resolved" as const,
			impact: "minor" as const,
			serviceIds: [],
			startedAt: "2026-11-02T00:00:00.000Z",
			createdBy: { type: "system" as const, id: "s", name: "S" },
			updatedAt: "2026-11-02T00:00:00.000Z",
		};
		render(
			<IncidentList
				empty=""
				incidents={[
					{
						...base,
						id: "a",
						title: "A",
						createdAt: "2026-11-02T10:00:00.000Z",
						updates: [],
					},
					{
						...base,
						id: "b",
						title: "B",
						createdAt: "2026-11-02T08:00:00.000Z",
						updates: [],
					},
					{
						...base,
						id: "c",
						title: "C",
						createdAt: "2026-11-01T08:00:00.000Z",
						updates: [],
					},
				]}
			/>,
		);
		expect(
			screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
		).toEqual(["Nov 2, 2026", "Nov 1, 2026"]);
	});

	it("lists statuses per kind", () => {
		expect(statusesFor("incident")).toContain("monitoring");
		expect(statusesFor("maintenance")).toContain("verifying");
	});
});
