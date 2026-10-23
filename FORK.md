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

The fork is not published to npm (`dsh-context` is upstream's package name). Install it from this repository:

```bash
# branch install; pnpm builds it on the fly through the package's prepare script
dsh plugin --profile web add github:zjbc2000/dsh-context#local
```

```bash
# or from a packed tarball
pnpm pack                       # in a clone of this branch → dsh-context-0.74.1.tgz
dsh plugin --profile web add /path/to/dsh-context-0.74.1.tgz
```

Then make sure `dsh-context` is listed in `dsh.profile.bundles` of `~/.dsh/profiles/web/package.json`, and restart
`dsh web` — plugin bundles are read at boot, so a running server keeps the old build.

## Notes

- Do not tag a release in the fork: upstream's `.github/workflows/release.yml` publishes `dsh-context` to npm on a tag.
- `local` is rebased/merged against upstream `main` regularly; the divergence is the four items above and nothing else.
- License: Apache-2.0, unchanged from upstream. Files modified by the fork are those under `src/client/`, `src/host/`,
  `src/shared/`, `tests/`; the change list in this file is the modification notice.
