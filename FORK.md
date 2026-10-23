# This is a fork

[`zjbc2000/dsh-context`](https://github.com/zjbc2000/dsh-context) is a fork of
[`bowenliang123/dsh-context`](https://github.com/bowenliang123/dsh-context) (Apache-2.0), tracking upstream `main`
and adding cost-visibility features on top. All changes relative to upstream live on the `local` branch.

Upstream's README below still describes the plugin as a whole. This file only records what the fork changes and how
to install it.

## What the fork adds

1. **Pricing disclosure** — the cost KPI card opens a breakdown of every billed model, grouped by provider (collapsed by
   default, so a wide account stays readable). Each provider row shows its token volume and price, and expands into its
   models with the price source: the registry branch and model id it priced from, or why nothing priced (`no book`,
   `unknown model`, `ambiguous`).
2. **Usage window** — the KPI row's usage chart covers the last 7 or 30 days (configurable), not a fixed week.
3. **Pricing preferences** — settings gain a `Cost estimation` group: display currency rate, peak factor, multiplier,
   whether actual spend is shown, and the pricing basis (`book` = the registry's listed price, `official` = the vendor's
   own listing for known model aliases).
4. **Official-listing aliases** — `glm-5.3-flash`, `glm-5.3`, `deepseek-*-flash` (i.e. DeepSeek V4.1 Flash) and
   `claude-sonnet-5-5` price from their vendor's first-party listing instead of whatever a reseller branch charges,
   regardless of which provider id the traffic actually went through. Undeclared aliases (a genuinely different tier
   such as `glm-5.3-flashx` or `deepseek-v4-pro`) keep the provider's own price.

## Install

The fork is not published to npm (`dsh-context` is upstream's package name). Install it from this repository into the
web profile; `dsh plugin` forwards its arguments to pnpm inside `~/.dsh/profiles/web`, and appends the installed bundle
to `dsh.profile.bundles` automatically.

```bash
dsh plugin --profile web add github:zjbc2000/dsh-context#local
```

A git-hosted install builds through the package's `prepare` script, which pnpm blocks by default. If the first run
fails on a blocked build, allow it in `~/.dsh/profiles/web/pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-context: true
```

To skip the build gate entirely, pack a tarball (`pnpm pack` in a clone of this branch, which runs `prepare` up front
and ships the built `lib/`) and install that:

```bash
dsh plugin --profile web add /path/to/dsh-context-0.74.1.tgz
```

Either way, restart `dsh web` afterwards — plugin bundles are read at boot, so a running server keeps the old build
(the browser refresh alone is enough only for client-only rebuilds of an already-loaded plugin).

## Notes

- Do not tag a release in the fork: upstream's `.github/workflows/release.yml` publishes `dsh-context` to npm on a tag.
- `local` is rebased/merged against upstream `main` regularly; the divergence is the four items above and nothing else.
- License: Apache-2.0, unchanged from upstream. Files modified by the fork are those under `src/client/`, `src/host/`,
  `src/shared/`, `tests/`; the change list in this file is the modification notice.
