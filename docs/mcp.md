# MCP server

Incident Command ships a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents can run the whole thing: declare and update incidents, change service status, schedule maintenance, and (with an admin token) manage members, tokens, subscribers and settings.

- **Endpoint:** `POST https://<your-host>/api/mcp`
- **Transport:** Streamable HTTP, stateless (every request is independent, so it scales horizontally and runs on serverless hosts). `GET`/`DELETE` return `405`.
- **Auth:** `Authorization: Bearer icmd_...`. Create tokens in the portal under **Agents & MCP**. The plaintext token is shown once; only a SHA-256 hash is stored.

## Connect

Claude Code:

```bash
claude mcp add --transport http incident-command https://status.example.com/api/mcp --header "Authorization: Bearer icmd_..."
```

Any client that supports remote MCP servers:

```json
{
	"mcpServers": {
		"incident-command": {
			"type": "http",
			"url": "https://status.example.com/api/mcp",
			"headers": { "Authorization": "Bearer icmd_..." }
		}
	}
}
```

Plain HTTP:

```bash
curl -s https://status.example.com/api/mcp \
  -H "Authorization: Bearer icmd_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'
```

## Roles

Each token has a role. Tools the role cannot use are not listed, so agents never see tools they cannot call.

| Role     | Can                                                                       |
| -------- | ------------------------------------------------------------------------- |
| `viewer` | Read status, services and incidents.                                      |
| `editor` | Everything a viewer can, plus manage services, incidents and maintenance. |
| `admin`  | Everything, including members, agent tokens, subscribers and settings.    |

## Tools

| Tool                   | Role   | What it does                                                                        |
| ---------------------- | ------ | ----------------------------------------------------------------------------------- |
| `whoami`               | viewer | The token's identity and role.                                                      |
| `get_status`           | viewer | Overall status, services with status and uptime, open incidents and maintenance.    |
| `list_services`        | viewer | All services (including hidden) in display order.                                   |
| `list_incidents`       | viewer | Incidents and maintenance, newest first. Filter by `kind` and `open`.               |
| `get_incident`         | viewer | One incident with its full timeline.                                                |
| `create_service`       | editor | Add a service.                                                                      |
| `update_service`       | editor | Edit a service (`null` clears description or group).                                |
| `set_service_status`   | editor | Change a service's status without an incident. Feeds uptime history.                |
| `delete_service`       | editor | Delete a service and its status history.                                            |
| `create_incident`      | editor | Declare an incident. Affected services move to a status derived from the impact.    |
| `post_incident_update` | editor | Add a timeline update, optionally changing status and service status.               |
| `resolve_incident`     | editor | Resolve an incident or complete maintenance; restores affected services.            |
| `edit_incident`        | editor | Change title, impact, services or the maintenance window without posting an update. |
| `delete_incident`      | editor | Delete an incident or maintenance.                                                  |
| `schedule_maintenance` | editor | Announce planned maintenance with a window.                                         |
| `list_members`         | admin  | Portal members.                                                                     |
| `invite_member`        | admin  | Create a one-time `inviteUrl` (valid for 7 days). The person creates their account. |
| `list_invites`         | admin  | Invites that nobody used yet.                                                       |
| `revoke_invite`        | admin  | Remove an invite. Its link stops working.                                           |
| `update_member`        | admin  | Change name, email, role or password.                                               |
| `remove_member`        | admin  | Remove a member (the last admin cannot be removed).                                 |
| `list_agents`          | admin  | Agent tokens.                                                                       |
| `create_agent_token`   | admin  | Create a token for another agent (returned once).                                   |
| `revoke_agent_token`   | admin  | Revoke a token immediately.                                                         |
| `get_settings`         | admin  | Status page settings and branding.                                                  |
| `update_settings`      | admin  | Change name, URLs, theme, brand color, custom CSS, subscriptions, uptime window.    |
| `list_subscribers`     | admin  | Email and webhook subscribers.                                                      |
| `add_subscriber`       | admin  | Add a confirmed email subscriber or a webhook.                                      |
| `remove_subscriber`    | admin  | Remove a subscriber.                                                                |

Results are JSON in a text content block. Expected failures (validation, not found, permission) come back as tool errors with `isError: true` and a message such as `not_found: Incident "inc_123" was not found`; unexpected failures return `internal_error` without leaking details.

## How incidents affect services

| Event                                     | Affected services become                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| Incident created, impact `minor`          | `degraded_performance`                                   |
| Incident created, impact `major`          | `partial_outage`                                         |
| Incident created, impact `critical`       | `major_outage`                                           |
| Incident created, impact `none`           | unchanged                                                |
| Maintenance moves to `in_progress`        | `under_maintenance`                                      |
| Incident resolved / maintenance completed | `operational`, unless another open incident affects them |
| Any update with `serviceStatus`           | exactly `serviceStatus`                                  |

Every status change is recorded and drives the 90-day uptime bars. Partial outages count as 30% downtime, major outages as 100%; degraded performance and maintenance do not count as downtime.

## Attribution and notifications

Updates are attributed to the agent (`author.type = "agent"`), visible in the portal timeline. Creating and updating incidents notifies subscribers unless you pass `notify: false`.
