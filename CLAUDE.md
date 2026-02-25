# Replyant — Project Guide

## What This Is

B2B services website for **Replyant** — an AI agent development, business automation, and strategic consulting company. Tagline: "Build Smarter. Grow Faster." Target audience: growing businesses (SMBs) evaluating AI investments.

Built with **Hugo** (v0.141.0 extended), hosted on **GitHub Pages** at `replyant.com`.

---

## Project Structure

```
replyant/
├── hugo.toml                  # Site config (menu, params, markup settings)
├── archetypes/
│   ├── blog.md                # Template for new blog posts
│   └── default.md             # Default archetype
├── content/
│   ├── blog/                  # Business-focused articles
│   │   ├── _index.md          # Blog landing page metadata
│   │   └── *.md               # Blog posts
│   └── lab/                   # Technical deep dives
│       ├── _index.md          # Lab landing page metadata
│       └── *.md               # Lab posts
├── themes/replyant/           # Custom theme (all layouts, CSS, JS)
│   ├── assets/css/style.css   # All styles (dark theme, CSS vars)
│   ├── layouts/
│   │   ├── index.html         # Homepage (hero, services, featured posts, CTA)
│   │   ├── _default/          # baseof.html, single.html, list.html
│   │   ├── blog/              # single.html, list.html
│   │   ├── lab/               # single.html, list.html (has "Technical" label)
│   │   └── partials/          # header.html, footer.html
│   └── static/
│       ├── fonts/             # Self-hosted Inter font (woff2)
│       ├── favicons/          # All favicon variants
│       └── js/                # nav.js, glow.js, homepage.js
├── static/
│   ├── robots.txt             # Allows all crawlers + AI bots
│   ├── CNAME                  # replyant.com
│   └── llms.txt               # AI-readable site summary
└── .github/workflows/hugo.yml # CI/CD: auto-deploy on push to main
```

---

## Content Sections

### Blog (`content/blog/`)
- **Purpose**: Business strategy content — ROI, hiring decisions, AI readiness, pricing
- **Audience**: Business owners and decision-makers
- **Tone**: Strategic, practical, ROI-focused

### Lab (`content/lab/`)
- **Purpose**: Technical deep dives — agent architectures, protocols, implementation details
- **Audience**: Developers, technical architects, CTOs
- **Tone**: Technical, detailed, hands-on
- **Visual difference**: Lab posts show a green "Technical" label and include a CTA box

---

## Blog Posting Flow

### 1. Create the file

Place the markdown file in the correct section:
- Business content → `content/blog/my-post-slug.md`
- Technical content → `content/lab/my-post-slug.md`

### 2. Front matter format (YAML)

```yaml
---
title: "Full Post Title Here"
date: 2026-02-24
tags: ["Tag1", "Tag2", "Tag3"]
description: "One-line summary for meta tags and list cards."
---
```

- `date` must not be in the future (Hugo won't publish future-dated posts by default)
- `tags` — typically 3-4 tags per post
- `description` — shows on list pages, homepage featured cards, and meta tags
- No `draft: true` unless you want it hidden

### 3. Content body

Write standard markdown below the front matter. Raw HTML is allowed (`unsafe = true` in config).

No custom shortcodes are used — just plain markdown + optional HTML.

### 4. Homepage featuring

The homepage automatically shows:
- **Top 3 blog posts** (most recent, filtered to exclude "AI Readiness Checklist")
- **Top 3 lab posts** (most recent)

New posts appear on the homepage automatically — no manual featuring needed.

### 5. Deploy

```bash
git add content/blog/new-post.md   # or content/lab/new-post.md
git commit -m "feat: publish new-post-name blog post"
git push origin main
```

GitHub Actions builds with `hugo --gc --minify` and deploys to GitHub Pages. That's it.

---

## Key Config Details

| Setting | Value |
|---------|-------|
| Base URL | `https://replyant.com/` |
| Theme | `replyant` (custom, in `themes/replyant/`) |
| Markdown | Goldmark with `unsafe = true` (raw HTML allowed) |
| Pagination | 10 posts per page |
| Forms | Self-hosted API (`leadsAPI` param in hugo.toml) |
| Font | Inter (self-hosted woff2) |
| Color scheme | Dark mode — `#0a0a0b` bg, `#6366f1` accent |

## Navigation Menu

1. Home (`/`)
2. Blog (`/blog/`)
3. Lab (`/lab/`)

Defined in `hugo.toml` under `[menu]`.

---

## Design System

- **Dark theme** with indigo/purple accents
- **CSS variables** in `themes/replyant/assets/css/style.css`
- **Container widths**: `1100px` (default), `740px` (narrow, for post content)
- **Mobile breakpoint**: `768px`
- **Animations**: Scroll-reveal (IntersectionObserver), card glow effect, hero entrance
- **Respects** `prefers-reduced-motion`

---

## Deployment

- **Trigger**: Push to `main` branch
- **CI**: `.github/workflows/hugo.yml` — GitHub Actions
- **Process**: Checkout → Install Hugo 0.141.0 → Build (`hugo --gc --minify`) → Deploy to GitHub Pages
- **Domain**: `replyant.com` (via CNAME file in `static/`)

No other deploy tooling (no Netlify, no Makefile, no npm scripts).

---

## Quick Reference: Adding a New Post

```bash
# Create from archetype (optional — or just create the file manually)
hugo new blog/my-new-post.md
hugo new lab/my-new-post.md

# Edit the generated file in content/blog/ or content/lab/
# Fill in: title, date, tags, description, then write the body

# Preview locally
hugo server -D

# Deploy
git add content/blog/my-new-post.md
git commit -m "feat: publish my-new-post blog post"
git push origin main
```
