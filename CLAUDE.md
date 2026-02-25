# Replyant

B2B website for Replyant — AI agent development, business automation, and strategic consulting. Built with Hugo, hosted on GitHub Pages at `replyant.com`.

## Environment Constraints

- **Hugo is NOT installed** in this environment. Do not run `hugo`, `hugo server`, or `hugo new` commands — they will fail.
- There are no build scripts, Makefiles, or npm/node tooling. Do not attempt to build or preview the site.
- Validation is handled by CI (GitHub Actions) on push to `main`.

## Key Paths

| What | Where |
|------|-------|
| Site config | `hugo.toml` |
| Blog posts | `content/blog/*.md` |
| Lab posts | `content/lab/*.md` |
| Styles | `themes/replyant/assets/css/style.css` |
| Layouts | `themes/replyant/layouts/` |
| JS | `themes/replyant/static/js/` |
| Partials | `themes/replyant/layouts/partials/` |
| Homepage | `themes/replyant/layouts/index.html` |
| CI/CD | `.github/workflows/hugo.yml` |

## Content Authoring

Blog = business audience. Lab = technical audience.

Front matter format (YAML):

```yaml
---
title: "Post Title"
date: 2026-02-25
tags: ["Tag1", "Tag2", "Tag3"]
description: "One-line summary for meta tags and list cards."
---
```

- `date` must not be in the future (Hugo skips future-dated posts)
- No shortcodes — plain markdown + optional raw HTML (`unsafe = true`)
- Homepage auto-features the 3 most recent posts from each section

## Commit Conventions

Follow the existing pattern from git log:

- `feat: <description>` — new features or content
- `fix: <description>` — bug fixes
- `refactor: <description>` — code restructuring

## Design Quick Reference

- Dark theme: `#0a0a0b` background, `#6366f1` indigo accent
- Font: Inter (self-hosted)
- Container: `1100px` default, `740px` narrow (post content)
- Mobile breakpoint: `768px`
- CSS variables defined at top of `style.css`
