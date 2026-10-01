<p align="center">
  <img src="assets/readme/hero.svg" width="960" alt="Switch to web models. Stay in Codex. Your ChatGPT plan. Your workflow. Maximum capabilities.">
</p>

<p align="center">
  <a href="https://github.com/miuuyy/codex-chatgpt-web/releases/download/v6.1.3/codex-web-gpt-6.1.3-win-x64.exe"><img src="assets/readme/download-windows.svg" width="224" height="64" alt="Windows · x64"></a>&nbsp;
  <a href="https://github.com/miuuyy/codex-chatgpt-web/releases/download/v6.1.3/codex-web-gpt-6.1.3-mac-arm64.dmg"><img src="assets/readme/download-macos.svg" width="224" height="64" alt="macOS · Apple silicon"></a>&nbsp;
  <a href="https://github.com/miuuyy/codex-chatgpt-web/releases/download/v6.1.3/codex-web-gpt-6.1.3-linux-x64.AppImage"><img src="assets/readme/download-linux.svg" width="224" height="64" alt="Linux · x64"></a>
</p>

<p align="center">
  <a href="https://github.com/miuuyy/codex-chatgpt-web/releases/download/v6.1.3/codex-web-gpt-6.1.3-mac-x64.dmg">macOS Intel</a> · <a href="https://github.com/miuuyy/codex-chatgpt-web/releases/latest">All releases</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="assets/demo.gif" width="960" alt="A live ChatGPT Web turn using the native Codex harness">
</p>

<p align="center">
  <a href="#get-started">Get started</a> · <a href="https://github.com/miuuyy/codex-chatgpt-web/releases">What’s new</a> · <a href="docs/architecture.md">Architecture</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a>
</p>

Use the ChatGPT Web models available on your account, including Pro, from Codex’s native model picker—with ChatGPT Web’s separate usage limits, without spending your Work or Codex quota. Keep the same interface, tasks, images, and streaming.

Full harness mode connects ChatGPT to the current task’s files, terminal, tools, and approvals through MCP. Conversations stay tied to your Codex task, so you can keep working as the context grows.

<div id="get-started"><a id="quick-start"></a></div>

## Get started

**Available models:** Free/Go → **Luna / Think**. Accounts with reasoning controls → **Instant–High**, plus **Extra High** and **Pro** when available. The launcher detects what your account can use.

1. **Install the launcher** using the download for your system above.
2. **Sign in to ChatGPT** in the embedded browser and run the browser smoke test.
3. **Install models** and restart Codex once. In automatic mode, choose a model ending in **(Web)**. Pro versions have separate entries; Sol reasoning is selected through Effort. Zero Risk keeps its dedicated entry.
4. **For coding with tools**, open **MCP** in the launcher and complete the Full harness setup below.

The app includes its browser and runtime. No separate Chrome, Node, or Bun installation is needed.

<details>
<summary><strong>Terminal install, updates & repair</strong></summary>

Quit the launcher before updating. These installers select the platform and architecture, verify the published checksums, and preserve your ChatGPT profile and launcher settings.

**macOS / Linux**

```bash
curl -fsSL https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.ps1 | iex
```

</details>

<details>
<summary><strong>Models, modes & MCP setup</strong></summary>

<a id="modes"></a>

Automatic modes offer Luna/Think when the account has no reasoning selector; otherwise Instant–High, with Extra High and Pro available independently when exposed by the account.

| Mode | Sending messages | Local Codex tools |
| --- | --- | --- |
| **Browser-only** | Automatic | No |
| **Full harness (With Automation)** | Automatic | Yes, through MCP |
| **Zero Risk** | Paste and send manually | Yes, through a separate MCP connector |

Zero Risk does not read or operate the ChatGPT page. Choose the model and `Codex Zero Risk` connector yourself, paste and send the prepared prompt, then confirm **Sent** in the launcher. Automatic models ending in **(Web)** expose their supported Effort choices in Codex. Instant and each Pro version have separate entries to preserve their context budgets; older saved model entries keep their original fixed mode.

<a id="full-harness"></a>

### Full harness

Full mode connects ChatGPT's tool calls back to the current Codex task through the official
[OpenAI tunnel-client](https://github.com/openai/tunnel-client). The tunnel is outbound: it does
not expose a public IP, open an inbound port, or require router forwarding.

The launcher's **MCP** page guides the complete setup. For the exact clicks, see the
[video walkthroughs](TROUBLESHOOTING.md).

> **Limits**
>
> See [Limits](https://github.com/miuuyy/codex-chatgpt-web/discussions/309) for the current
> ChatGPT message allowances for **GPT-5.6 Sol Pro** and **GPT-6 Astra**. Context limits depend on
> the account type and selected effort. Plus Medium/High uses a measured 90,000-token window, or
> up to 270,000 tokens with experimental **3× context** enabled, with native Codex compaction
> supported throughout.

1. Finish the required setup, open **MCP**, create the Tunnel and regular API key, then press
   **Connect harness**.
2. Enable ChatGPT **Developer Mode** and create a new Tunnel connector named exactly
   **Codex Native2**, with **Authentication: None** and **Allow all actions**.
3. Run **Verify runtime** to confirm that **Codex Native2** is attached and available.

Write/modify actions also require the ChatGPT workspace and its administrator policy to permit
them. See
[developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
Unexpected approval prompts fail closed unless `--auto-approve-tool-calls` is explicitly enabled;
that option clicks **Allow once**, never a permanent grant.

</details>

<details>
<summary><strong>Diagnostics & subagents</strong></summary>

<a id="operations"></a>

Use **Activity** for safe local diagnostics and **Settings → Run doctor** for end-to-end health.
Settings can also cancel a retained browser turn or remove the Codex integration before uninstall.
**Save chats in ChatGPT** keeps task conversations in ChatGPT history. Off by default; independent of **New browser chat for each turn**.
Set `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1` only when ordinary browser checkpoints need screenshots.
Prompt-fidelity failures also write a `prompt-attachment-integrity-mismatch` JSON checkpoint before
clearing the composer. It records raw/equivalence-aware prefixes, suffix realignment, differing
UTF-16 units/code points, escaped local context, line offsets, and bounded composer-node structure.
Each context covers up to 32 UTF-16 units before and after a mismatch; if raw and equivalence-aware
mismatches differ, both windows are retained, capped at 128 source units per expected/actual side.
These failure-only artifacts contain no complete prompt, composer HTML, screenshot, or general
page state. The bounded excerpts may still contain task text: treat them as private diagnostics.
Capture is best effort; failure still rejects the turn before Send and clears the draft.
Prompt verification permits ASCII space → NBSP only within repeated ASCII-space runs or immediately
after an expected newline, where native contenteditable insertion preserves paragraph indentation.
Single interior spaces, tabs, newline changes, intentional expected NBSP, length changes, and text
mutations remain exact and fail closed; insertion and DOM extraction are unchanged.

New installs use **Compatibility V1** for cross-backend subagents. **Native** preserves Codex's own
feature settings and enables plaintext Web-to-Web V2 delegation. Restart Codex and start a new task
after changing the protocol:

```bash
codex-chatgpt-web subagents status
codex-chatgpt-web subagents compatibility-v1
codex-chatgpt-web subagents native
```

</details>

<details>
<summary><strong>Requirements & security</strong></summary>

<a id="limitations-and-security"></a>

- This is unofficial browser automation, not an OpenAI API. ChatGPT UI changes can break selectors;
  drift fails explicitly instead of silently switching model or transport.
- Browser state is a sensitive login artifact, and the loopback listener is reachable by processes
  running as the same local user. Never share the launcher profile; use a trusted workstation.
- Release packages currently target macOS 13+ (arm64/x64), Windows x64, and Linux x64. Runtime,
  tests, and packaging are gated on all three in CI; account-bound browser and MCP flows use the
  separate [release validation](docs/release-validation.md).
- Builds are not yet platform-signed, so Gatekeeper or SmartScreen may warn. The installers verify
  the published SHA-256 manifest before installation.

Read the complete [architecture](docs/architecture.md) and
[security model](docs/security-model.md) before enabling full mode. Report vulnerabilities through
[SECURITY.md](SECURITY.md).

Temporary Chat is a [ChatGPT privacy mode](https://help.openai.com/en/articles/8914046-temporary-chat-faq); prompts are still processed by OpenAI.

Validation coverage: [release validation](docs/release-validation.md).

This is independent software and is not affiliated with or endorsed by OpenAI. Use it only with
your own account and in accordance with applicable [Terms of Use](https://openai.com/policies/terms-of-use/)
and workspace policies; it does not bypass authentication or access controls.

</details>

<details>
<summary><strong>Run from source & develop</strong></summary>

<a id="development"></a>

```bash
git clone https://github.com/miuuyy/codex-chatgpt-web.git && \
cd codex-chatgpt-web && \
bun run app
```

This source path requires Bun 1.4.0. The command installs locked dependencies and opens the app.

```bash
bun run app
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat compaction-lab "Reply with exactly: DEV READY"
bun run verify
bun run smoke:subagents
bun run app:package
```

`dev:launcher` uses a separate profile and account under `~/.codex-chatgpt-web-dev`. `dev:chat` exercises the real browser and compaction paths with explicit simulated tool results, without changing your normal Codex route. See the [DEV chat harness](docs/dev-chat.md) for setup and commands.

</details>

## Explicit ChatGPT model selections

The sibling `omp-chatgpt-web-bridge` can request an explicit ChatGPT model through
this adapter's existing browser worker. The requested model and reasoning effort
are independent; this path does not change ordinary Codex model registration or
launch or own the authenticated browser profile.

The registry names `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-6-luna`, `gpt-6-sol`, `gpt-6-terra`, `gpt-6.1-luna`, `gpt-6.1-sol`,
and `gpt-6.1-terra`. Only `gpt-5.6-sol` has a verified exact normal ChatGPT
selector contract. A configured ID is not evidence that ChatGPT exposes that
model on a particular account. Luna is unavailable on this path until an exact,
positive selected-model identity can be verified: the absence of a Sol
selector and the presence or absence of Think do not identify a requested
version or model family. Terra and the other Sol/Luna IDs likewise remain
unavailable until their own exact selector contracts are verified.

The connector-free provider does not require a Sol-capable account. Different
authenticated ChatGPT accounts may expose different subsets of this catalogue.
A Free account that exposes Luna can be supported once Luna's exact browser
identity and selected-state contract is positively verified in that account;
that verification is not required to configure `gpt-5.6-luna`.

For GPT-5.6 Sol, native `none` and `low` resolve to Instant; `medium`, `high`,
and `xhigh` retain their corresponding Sol controls. Before every physical
Send, including retained continuation and multipart staging, the adapter
re-verifies the exact selected model and effort. It does not fall back to
another model or reasoning level. Unsupported, locked, or unverifiable
selections fail without sending a message or claiming account availability.
A disabled reasoning control is accepted only when it exposes exactly one
unlocked position, that position is selected, and the request maps to it; exact
model and effort identity are still verified. Disabled multi-position controls
and requests for any other position fail closed.
The singleton power picker can expose `Instant, 1 of 1.` on its disabled keyboard
owner while the underlying Radix thumb retains its default `0..1` range.
Only that exact owned announcement, one selected tick without a lock marker,
and the observed disabled control structure are recognized as the single Instant
position. Other ambiguous or locked controls still fail closed; the checked
GPT-5.6 Sol row and exact effort announcement must independently match before Send.


### Browser-backed OMP launch

Use `omp-chatgpt-web` for sessions using the `ebay-chatgpt-web/*` provider.
The project-owned launcher in `bin/omp-chatgpt-web` selects the existing
`~/.omp/agent/config.ebay-instant.yml` overlay through `PI_CONFIG_FILES` and
passes OMP's native `--no-title` flag as the primary automatic-title suppression
mechanism. It also exports `PI_NO_TITLE=1` only to that OMP process and its
children as defense in depth. Idle recap remains disabled through the browser
overlay, which must include:

```yaml
recap:
  enabled: false
memory:
  backend: off
```

Automatic titles, idle recaps, and local-memory startup are disabled for browser
sessions. Titles can race foreground work; idle recaps use the active session
model rather than the memory role; local-memory startup can launch concurrent
rollout summarization requests using the browser-backed memory role and the
foreground session's request identity. The bridge
remains single-task; these controls prevent those auxiliary requests from
competing for its browser lease. They do not disable tools, subagents, or
explicit user-requested work, and they do not add concurrent browser tasks.

The launcher also loads the sibling checkout's production provider extension,
`../omp-chatgpt-web-bridge/omp/ebay-chatgpt-web.ts`, resolving its path relative
to the real launcher rather than the task directory. Both checkouts are required.
This reuses the existing provider catalogue and `openai-responses` contract at
`http://127.0.0.1:17844/v1`, including `reasoningDisableMode: "none-effort"`.
Without that registration, a catalogue-only provider can serialize OMP `off`
as a reasoning tier instead of Instant. The overlay selects
`ebay-chatgpt-web/gpt-5.6-sol:off`. A configured model or effort remains subject
to the authenticated account's availability.

If `~/.omp/agent/models.yml` already declares this provider, its `gpt-5.6-sol`
model must also declare `compat.reasoningDisableMode: none-effort`. Interactive
catalogue hydration can otherwise replace the extension's wire compatibility
and serialize `off` as `low`, including between tool rounds. Keep this override
model-scoped; do not change sibling models or unrelated provider credentials.
Verify the native interactive request payload, not only a text-mode probe.

Attached-Chrome new-chat navigation waits for document commit, then verifies the
visible composer, authenticated surface, and requested new-chat URL. Deferred
resources need not finish before those checks; model/effort and prompt-integrity
checks still run before Send. Managed-Chrome and launcher navigation retain
their existing readiness behavior.

Retained conversations verify the owned page, document marker, exact route, and
previous trusted user-turn anchor before each continuation. After the response,
one DOM snapshot must verify that previous anchor and select the newest mounted
user turn. Page, marker and route are rechecked before accepting the continuation.
This identity chain tolerates virtualized older turns but fails closed if the
previous anchor disappears, the route changes, or the document is replaced.

On this host, `~/.local/bin/omp-chatgpt-web` links to the project launcher.
To install the command from another checkout, with OMP already on `PATH`:

```bash
ln -s "$PWD/bin/omp-chatgpt-web" "$HOME/.local/bin/omp-chatgpt-web"
```

Start a fresh session from the task directory:

```bash
cd /path/to/task
omp-chatgpt-web
```

The launcher forwards OMP arguments and preserves existing environment overlays,
appending the browser overlay. Later explicit `--config` overrides or in-session
setting changes can supersede it; do not re-enable recap or a memory backend for
browser-backed sessions. Use ordinary `omp` and the normal overlays for unrelated
API-backed sessions; their title, recap and memory behavior remains unchanged.

Check the effective setting without sending an inference request:

```bash
omp-chatgpt-web config get recap.enabled --json
omp-chatgpt-web config get memory.backend --json
```

These must report `false` and `"off"` respectively. No bridge, Chrome, or Xvfb restart is needed.
Validate a fresh launch's effective provider/reasoning and foreground workload;
a configuration probe alone does not establish live dashboard acceptance.

## Star History

<a href="https://www.star-history.com/?repos=miuuyy%2Fcodex-chatgpt-web&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&theme=dark&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
  </picture>
</a>

---

[Troubleshooting](TROUBLESHOOTING.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE) · [CI](https://github.com/miuuyy/codex-chatgpt-web/actions/workflows/ci.yml)

Also by me: <img src="assets/readme/persona-voice.svg" width="20" height="20" alt=""> [ChatGPT Persona Voice](https://github.com/miuuyy/ChatGPT-Persona-Voice) — local, near-real-time custom voices for ChatGPT and Codex.
