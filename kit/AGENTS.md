# <project> agent guide

## Project

- Repository: `<project>`
- Production branch: `<production_branch>`
- Deploy provider: `<deploy_provider>`
- Database provider: `<database_provider>`
- UI library: `<ui_library>`

Read `pipeline.yml` before changing the repository. Work only within the ticket's allowed paths (or `allowed_paths_default` when the ticket does not override them). Use the commands declared in `pipeline.yml`; do not assume a package manager or framework.

Before handing off work, run the configured lint, typecheck, and test commands. Treat a command value of `none` as a configuration gap that requires human direction.

## Review protocol

Follow the repository's review requirements before merging changes.

Do not edit kit-owned paths by hand. They are replaced by `pipeline init`, except this file: an existing `AGENTS.md` is never overwritten and its differences are reported instead.
