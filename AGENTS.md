# Agent guidance

Durable rules for coding agents in this checkout. This is not a runtime inventory and not a stage history.

## Repository relationship

- This checkout carries project-specific changes on top of upstream `miuuyy/codex-chatgpt-web`.
- `origin` is the writable `BlackOpsAutomation/codex-chatgpt-web` fork.
- `upstream` is `miuuyy/codex-chatgpt-web`.
- Never push project-specific changes directly to upstream.
- Inspect current refs and remotes before synchronization work.
- Do not silently merge or rebase upstream.

## Engineering workflow

- Inspect the repository and relevant live state before implementation.
- Work in bounded, independently testable changes.
- Implementation, then validation, then independent review, then an authorized commit and push.
- Planning and investigation do not commit.
- Do not commit or push before the review and authorization gate unless explicitly authorized.
- Preserve a cheap rollback.
- Fix ordinary concrete implementation or build problems autonomously inside the bounded task.

## attached-chrome invariants

- Chrome owns authentication and profile lifecycle.
- `attached-chrome` consumes an already-running Chrome BrowserContext.
- Do not use attached-chrome to perform Google or OpenAI authentication bootstrap.
- Do not copy, export, or replay cookies, tokens, credentials, Local Storage, IndexedDB, or browser databases.
- Do not introduce Playwright `storageState` as a requirement for attached mode.
- Do not terminate externally owned Chrome on adapter disconnect.
- Do not create an isolated BrowserContext for attached mode.
- CDP must remain loopback-only.
- Never expose CDP publicly.
- Do not silently change managed-chrome or launcher semantics while modifying attached-chrome.
- Reuse the existing ChatGPT DOM and turn implementation rather than creating a second adapter.

## Runtime boundary

- The verified persistent profile is `~/.chatgpt-omp/browser/profile`.
- The verified display architecture is headed Chrome on Xvfb.
- VNC is recovery and bootstrap tooling, not normal application transport.
- Do not require a full desktop environment.
- Do not route this project through Codex authentication or the Codex backend merely because that integration is easier.
- Normal Chat and Codex are separate product and authentication paths for this project.

## Validation

- Build and tests alone are not sufficient for browser ownership or lifecycle changes. Use a bounded smoke test.
- Never use the authenticated profile for disposable experiments when a temporary profile can prove the behavior.
- Distinguish concrete regressions from unrelated environment or test failures.
- Do not hide failing tests. Report and classify them.

## Repository boundaries

- Do not modify `/home/wintersun/dev/omp-chatgpt-web-bridge` merely because browser ownership changes.
- Runtime helpers under `~/.chatgpt-omp` are outside this Git repository.
- Do not include runtime, auth, or profile artifacts in commits.
