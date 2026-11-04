# Security Policy

We take security seriously and work to keep this project up to date. If you discover a security vulnerability, report it in public and email the maintainer. Security work on this project stays transparent.

## Reporting a vulnerability

Do both:

1. **Open a public GitHub issue** on this repository. Put `[SECURITY]` in the title and include the details below. The issue is the public record.
2. **Email** the same report to me@jaredwray.com with `[SECURITY]` in the subject line, and include the link to the issue you opened.

When reporting, please include as much of the following as you can:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof-of-concept.
- The affected version(s) and platform.
- Any suggested remediation, if you have one.

We will acknowledge receipt on the issue and by email, fix it in public, and credit you on the issue once a fix is published unless you ask to remain anonymous.

## How this repository is secured

This repository follows the [defense-in-depth](https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md) hardening checklist; progress is tracked in [DEFENSE_IN_DEPTH.md](./DEFENSE_IN_DEPTH.md). Measures currently in place:

- Codespaces, Cursor Cloud Agents, and Claude Code on the web install through Aikido Safe Chain; package-manager shims must not be bypassed.
- The Codespaces Dev Container image is pinned by digest (`name:<tag>@sha256:<digest>`), not a floating tag.
- Dependencies install through pnpm with a 7-day cooldown on new versions, lifecycle scripts blocked by default, and `trustPolicy: no-downgrade`. Socket reviews every dependency change; Aikido scans every build.
- CI runs with read-only permissions (only jobs whose purpose is mutating the repo get `contents: write`); generated output is an artifact, never committed back; every action is pinned to a full commit SHA; Socket Firewall (`sfw`) wraps `pnpm install` / `npm install`; workflows are security-linted with zizmor on every PR.
- All changes land through pull requests — direct pushes to `main` are blocked, and merging requires passing status checks.
- Tags can only be created by repository admins; published GitHub Releases are immutable (assets and tags cannot be changed after publish).
- Workflow runs from outside collaborators always require maintainer approval, and only allowlisted GitHub Actions can run.
