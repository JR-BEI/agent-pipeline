# Agent pipeline contributor guide

This repository contains reusable automation that is copied into other repositories. Keep every template project-neutral: target-specific values belong in `pipeline.yml`, never in files under `kit/`.

## Working here

- Support Node.js 18 and newer.
- Runtime dependencies are limited to the Node.js standard library and `js-yaml`.
- Treat paths listed in `DEFAULT_OWNED_PATHS` in `bin/pipeline` as the kit's public ownership contract.
- Never overwrite a target repository's existing `AGENTS.md`; show its drift instead.
- Print filesystem mutations before applying them.
- Add or update tests for changes to `init`, `check`, the schema, or templates.

Run `npm test` before submitting changes.
