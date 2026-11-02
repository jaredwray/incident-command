# Theming

Every color, radius and font in the UI comes from a small set of CSS custom properties (design tokens). Components only use Tailwind CSS v4 utilities mapped to those tokens (`bg-surface`, `text-muted`, `border-border`, `bg-operational`, `rounded-card`, …), so a theme is nothing more than a set of variables.

There are three levels of customization, from no code to full control.

## 1. In the portal (no code)

**Manage → Settings → Branding**:

- **Theme:** pick a preset: `default` (light, follows system dark mode), `midnight`, `ocean`, `sunset` or `mono`.
- **Brand color:** any hex color. The readable foreground (black or white) is computed automatically.
- **Logo and favicon URLs.**
- **Custom CSS:** inlined on every page after the theme, so it can override any token or style. `<` is escaped so the stylesheet can never break out of its `<style>` tag.

Agents can do the same with the `update_settings` MCP tool.

## 2. Override tokens with custom CSS

```css
/* Load a web font (@import must come first) */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");

/* Rounder cards, the custom font and a softer background */
:root,
[data-theme] {
	--ic-radius: 1.5rem;
	--ic-font: "Inter", ui-sans-serif, system-ui, sans-serif;
	--ic-bg: #fafaf9;
}
```

| Token                | Used for                          |
| -------------------- | --------------------------------- |
| `--ic-bg`            | Page background                   |
| `--ic-surface`       | Cards                             |
| `--ic-surface-muted` | Group headers, subtle fills       |
| `--ic-fg`            | Primary text                      |
| `--ic-muted`         | Secondary text                    |
| `--ic-border`        | Borders and dividers              |
| `--ic-brand`         | Buttons, links, focus rings       |
| `--ic-brand-fg`      | Text on brand-colored backgrounds |
| `--ic-operational`   | Operational status                |
| `--ic-degraded`      | Degraded performance              |
| `--ic-partial`       | Partial outage                    |
| `--ic-major`         | Major outage                      |
| `--ic-maintenance`   | Maintenance                       |
| `--ic-nodata`        | Uptime bars with no data          |
| `--ic-radius`        | Card corner radius                |
| `--ic-font`          | Font stack                        |

## 3. Add a theme preset (code)

1. Create `src/themes/<id>.css`:

   ```css
   [data-theme="forest"] {
   	--ic-bg: #f3f7f2;
   	--ic-surface: #ffffff;
   	--ic-surface-muted: #e8f0e6;
   	--ic-fg: #10200f;
   	--ic-muted: #4d6150;
   	--ic-border: #d5e3d2;
   	--ic-brand: #2f7d32;
   	--ic-brand-fg: #ffffff;
   	--ic-operational: #2f9e44;
   	--ic-degraded: #d9a400;
   	--ic-partial: #f0700f;
   	--ic-major: #c92a2a;
   	--ic-maintenance: #3b6fd8;
   	--ic-nodata: #dbe6d8;
   	--ic-radius: 0.75rem;
   	color-scheme: light;
   }
   ```

2. Import it in `src/app/globals.css` next to the other presets.
3. Add `{ id: "forest", name: "Forest", description: "..." }` to `THEMES` in `src/lib/theme.ts`.

It now appears in the portal's theme picker. The selected preset is set as `data-theme` on `<html>`, so presets can also target dark mode with `@media (prefers-color-scheme: dark)` like `src/themes/default.css` does.

## Going further

The status page is built from small presentational components in `src/components/status/` (banner, incident card, uptime bars, system status, timeline). Fork and restyle them freely; the data they render comes from `services.status.summary()`, which is also exposed as public JSON at `/api/v1/status` if you would rather build a completely custom frontend.
