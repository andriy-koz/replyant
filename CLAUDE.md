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
| Tag pages | `content/tags/<tag-slug>/_index.md` |
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
author: "Replyant"  # optional — defaults to site author in hugo.toml
---
```

- `date` must not be in the future (Hugo skips future-dated posts)
- No shortcodes — plain markdown + optional raw HTML (`unsafe = true`)
- Homepage auto-features the 3 most recent posts from each section
- Tags are linked to taxonomy pages (`/tags/tag-name/`) — reuse existing tags when possible
- **When adding a new tag**, create a matching `content/tags/<tag-slug>/_index.md` with a unique `description` (120-150 chars) and 100-200 words of introductory content. This prevents duplicate meta descriptions and thin-content issues on tag pages.

## SEO & GEO Guidelines

All posts are automatically enriched with Open Graph, Twitter Card, and JSON-LD via `partials/seo.html`. No manual SEO markup needed in content files — just write good front matter.

Structured data coverage (all template-driven — no manual markup needed per post):
- **Homepage**: Organization + WebSite schemas
- **All sub-pages**: Organization + BreadcrumbList schemas (breadcrumb trail built automatically from section/page hierarchy)
- **Blog posts**: BlogPosting schema (automatic)
- **Lab posts**: TechArticle schema (automatic)
- **Tag pages**: CollectionPage + ItemList schema (automatic, lists all tagged articles)
- **Meta descriptions**: Tag pages use their `_index.md` description, with a dynamic fallback for any tag missing one

### Writing for search engines AND LLMs

- **Lead with the answer.** Put the core takeaway in the first paragraph — LLMs cite passages, not pages.
- **Use definitive statements.** Avoid hedging ("might", "could possibly"). Make clear, quotable claims.
- **Include statistics and data.** Verifiable numbers boost AI citation rates by ~40%.
- **Structure with H2/H3 headings.** Clear hierarchy helps both Google and LLM retrieval.
- **Write 50-70 word "answer capsules"** after question-style headings — the ideal unit for AI citation.
- **Cross-link related posts.** Build topical authority through internal links with descriptive anchor text (not "click here").

### Front matter best practices

- `title`: Include target keyword naturally. **Must be under 70 characters** — titles longer than this get truncated in SERPs, hurting click-through rates. Count characters before committing.
- `description`: **120-160 characters, never exceed 160.** This populates meta description, OG tags, and list cards. Write it as a standalone pitch — it's what people see before clicking. Truncated descriptions in SERPs waste impressions.
- `tags`: 3-4 tags. Reuse existing tags to build taxonomy depth (check `/tags/` for current list).
- `author`: Optional per-post override. Defaults to `params.author.name` in `hugo.toml`.

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
