# Configuration

Every mutating command prints its plan before applying it. `init` replaces content at kit-owned paths, including deleting extra files below owned directories. The exception is `AGENTS.md`: an existing file is preserved and a diff against the kit template is printed. An existing `pipeline.yml` is also preserved because it contains project configuration.

`check` validates configuration, reports template drift per file, checks the configured test/lint/typecheck commands without executing them, and verifies through `gh api` that the production branch requires the `ci` and `review` checks. Because existing project instructions are preserved, `AGENTS.md` is not compared with the template; it only needs to exist and contain a `Review protocol` line, as a Markdown heading of any level (for example `## Review protocol`) or a plain line. Set `GITHUB_REPOSITORY=owner/repo` when the target does not have an `origin` remote.

Inventory mode proposes, but never performs, deletion of old pipeline-like files outside the configured owned paths: `scripts/night`, runner-named scripts, workflows whose latest run is more than 30 days old, and unreferenced `.claude/commands` files. Optional `keep_paths` entries protect matching files or directory trees from these proposals.

## `pipeline.yml`

Fields marked optional can be left out. Everything else is required. Defaults shown in comments are written by `pipeline init`; command values that cannot be inferred are written as `none` and included in the human checklist. Model selections below are examples; `init` writes `none` for builder tiers and an empty reviewer map, which must be filled in before `check` can pass.

```yaml
project: my-app
owned_paths:
  - .github/workflows/ci.yml
  - .github/workflows/review.yml
  - .github/workflows/migrate.yml
  - .github/ISSUE_TEMPLATE/ticket.yml
  - AGENTS.md
  - CLAUDE.md
  - .claude/settings.json
  - scripts/lane/
  - scripts/agent/
keep_paths:                     # optional inventory exclusions
  - scripts/night/keep.js
commands:
  install: npm ci
  dev: npm run dev
  test: npm test
  lint: npm run lint
  typecheck: npm run typecheck
  migrate: none
  snapshot: none
deploy:
  provider: none              # vercel | none
  production_branch: main
database:
  provider: none              # supabase | postgres | none
  lane_setup: none
supabase:                     # optional
  project_ref: abcdefghijklmnopqrst
snapshots:                    # optional
  keep: 3                     # positive integer
  part_mb: 45                 # 1 to 45
verify:                       # optional
  real_data_diff:             # optional; when present, paths and command are both required
    paths:                    # repository-relative globs; ** crosses directories, * and ? do not
      - lib/ingest/*.ts
    command: node --import tsx scripts/agent/real-data/run.ts
ui_library: null              # for example, "@example/ui"
models:
  tiers:
    light: gpt-5.6-terra       # builder model ID
    standard: gpt-5.6-sol
    hard: gpt-6-astra
  reviewer:                   # builder model ID -> reviewer model ID
    gpt-5.6-terra: gpt-6-astra
    gpt-5.6-sol: gpt-6-astra
    gpt-6-astra: claude-sonnet-5-5
  review_location:
    openai: mac               # mac | ci; init default: mac
    anthropic: ci             # mac | ci; init default: ci
  escalations_per_ticket: 1
budget:
  default_usd: 10
  max_review_rounds: 3
  wall_clock_minutes:         # optional; positive integers for all three tiers
    light: 20
    standard: 45
    hard: 90
runner:
  git_name: example-bot       # identity for every lane commit
  git_email: 1+example-bot@users.noreply.github.com
allowed_paths_default: []
```

The authoritative JSON Schema is [`schema/pipeline.schema.json`](../schema/pipeline.schema.json). Unknown fields are rejected. Budgets must be non-negative; escalation and review counts must be non-negative integers. Model IDs are strings. `models.reviewer` maps builder model IDs to reviewer model IDs, with an entry for every model named in `models.tiers`. Each reviewer must differ from its builder; different models from the same provider are allowed. `models.review_location` requires `openai` and `anthropic`, each set to `mac` (runner with subscription login) or `ci` (Actions with an API key). `check` verifies reviewer assignments and provider locations, inferring OpenAI from `gpt-*` and Anthropic from `claude-*`; unrecognized reviewer IDs fail with a provider inference error. `runner.git_name` and `runner.git_email` are required; the email must be an address, and Vercel verifies it against a GitHub account, so use that account's noreply address. `init` writes `none` for both, which `check` rejects until they are set. `verify.real_data_diff` is optional, but a `paths` list without a `command` fails with a message naming the missing command. JSON Schema validates the shape, and `check` validates the cross-field relationships, reporting one line per problem.

The initial workflow template directory is intentionally empty. The three workflow paths are reserved in `owned_paths`; until a later kit version supplies them, `check` reports them as reserved rather than missing.

