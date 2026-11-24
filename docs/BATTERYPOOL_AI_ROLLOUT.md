# BatteryPool AI rollout

## Recommended split

Give all employees the existing Bedrock Chat for questions, writing, document review, and shared knowledge bots. Give software and firmware engineers Kiro (Web for browser/background tasks, IDE/CLI for local work), or Claude Code backed by Amazon Bedrock for work in their local repository. Product staff can use chat for everyday work and Kiro for repository-backed specs and implementation reviews.

With surplus Activate credits, optimize for useful work and employee adoption. Keeping a document/chat application is valuable; building a second repository execution agent duplicates capabilities already available in managed developer tools.

Kiro and Bedrock have separate model catalogs and billing. Kiro subscriptions consume AWS billing credits when eligible; Claude Code configured with Bedrock sends inference to your AWS account. Confirm the applicable services, expiration and application history of your actual grant. Taxes may still be payable. Do not assume every newer model/provider is covered just because it appears in a catalog.

## Models

Defaults in `cdk/cdk.json`:

| Role | Model | Reason |
|---|---|---|
| Everyday work and coding | Claude Sonnet 4.6 | General default among models AWS Support confirmed |
| Difficult analysis, architecture and debugging | Claude Opus 4.6 | Deliberate work where deeper reasoning is worthwhile |
| Quick replies and conversation titles | Claude Haiku 4.5 | Lower latency for straightforward work |
| Alternative | Claude Sonnet 4.5 | Existing confirmed access |
| Optional models under “all models” | Kimi K3, DeepSeek V3.2 | Preserve existing custom integrations; smoke-test before rollout |

This is an account-access baseline, not a claim that these are the newest models in every catalog. Evaluate newly available models on a fixed set of BatteryPool tasks, then update the frontend/backend registry and allowlist together. Do not label an untested catalog entry as ready for employees.

Keep reasoning off for routine work and enable it for hard tasks. Existing long-reply settings remain in place. Large contexts and long reasoning still take longer, even when credits are plentiful. Ordinary chat already uses prompt caching where the selected model supports it.

## Upload behavior

| Item | Limit / behavior |
|---|---|
| File upload | 25 MiB each; 10 files; 100 MiB total per message (UI displays MB) |
| Extracted text | 600,000 characters across attachments on the selected conversation path |
| Original PDF/DOC/XLS | Up to 4.5 MiB each, five original documents across the selected conversation path; choose Claude |
| Larger PDF | Extract searchable text up to the text limit; no OCR; page cap 1,000; diagrams/scanned pages excluded |
| DOCX/PPTX | Extract text, with an explicit notice that layout/images/embedded objects are omitted |
| XLSX | Extract sheet names and cached cell values; formulas without caches may be blank; no recalculation, charts or macros |
| Source ZIP | Up to 1,000 entries and 50 MiB expanded; include readable source files with paths; omit generated/binary/environment files and common dependency directories, reporting counts |
| Images | Existing resized-image workflow remains, with size derived atomically from the actual queue rather than a stale counter |
| Preview | First 20,000 text characters, clearly labelled; original download uses a five-minute signed URL |

Character caps are application processing bounds, not a promise about model token counts. The selected model's context and document limits still apply. Oversized extracted text is rejected with instructions to split the content or use a knowledge-base bot; no text is silently truncated for inference. Source archives clearly report skipped files. Spreadsheets are presented to the model as text, not executed in a spreadsheet engine.

### File storage and lifecycle

Authenticated requests create an exact-size presigned POST scoped to a random, user-owned upload ID. File bytes go straight to private S3; Lambda/chat/history receive only small references. Completion validates byte length and parses content once. Both legacy Converse and Strands resolve the reference for inference. The server validates ownership before accepting a reference and binds it to one conversation when persisting a successful response.

The existing private large-message bucket receives CORS configuration for signed uploads and two narrowly scoped lifecycle rules: staging objects expire after one day, and completed unsubmitted objects tagged `unattached` expire after seven days. A successfully persisted attachment is marked retained. Single-chat deletion removes its bound attachments; clear-all removes all the user's new attachment objects. Existing conversation objects are outside the new lifecycle filters. Cleanup is subject to S3 lifecycle scheduling, not immediate expiration at the hour boundary.

Completed files removed from an unsent draft age out after seven days. The file picker never sends application Authorization headers to S3. Generated download URLs are temporary bearer links. Uploads/archives are parsed as data and never executed.

## Deployment

Deploy the backend, S3 CORS/lifecycle changes and frontend together, first in a staging environment. A frontend-only deployment will not have the new upload endpoints. Preserve the production Cognito, custom domain, network, and existing CDK context overrides. Review `CdkJsonOverride`, `RepoUrl`, and `Version` on the existing `CodeBuildForDeploy` stack before changing deployment inputs. Defaults in `bin.sh` are not a reproduction of the production deployment.

This branch is based on `batterypool-models`. Merge the reviewed changes into that branch before running the existing deployment, or explicitly configure a staging build to use the review branch. Verify the exact successful build commit. The configured production source previously reported by the owner was `https://github.com/Vaibhavriju/bedrock-chat.git`, branch `batterypool-models`.

Check that no deployment override replaces the intended model list or defaults. Confirm Sonnet 4.6, Opus 4.6 and Haiku 4.5 work in the actual Bedrock account/Region before inviting more employees. Preserve SnapStart unless your Region does not support it.

### Required staging smoke test

1. Sign in as two separate users. Upload a UTF-8 source file, uppercase `.PDF`, `Dockerfile`, source ZIP, DOCX, PPTX and XLSX. Check upload progress, cancellation, retry, notices and previews/downloads.
2. Upload an allowed file over the old 4.5 MB transport cap (for example a searchable PDF between 5–25 MB or a source archive), staying within extraction limits. Ask a question that depends on its contents, then refresh history and repeat the question.
3. Remove/re-add files, send a second attachment-bearing message, and confirm no stale size error. Check aggregate count/byte/character rejection paths and a multi-document conversation.
4. Try another user's reference and arbitrary S3 paths. Expect rejection. Test opening/downloading a file in its owner's history and deleting that chat, including retrying a partial deletion.
5. Verify an existing pre-release conversation with inline attachments still opens and can continue.
6. Exercise the recommended models and optional Kimi/DeepSeek separately. Record first-token time and full response time for short chat, long document and code tasks. No live model-latency benchmark has been performed by the code author.
7. Test mobile-width layout, keyboard navigation, IME entry, dark mode and a long streaming code block. Desktop and 150% browser-zoom checks of the deployed UI correction passed on 24 November; a real mobile keyboard and the remaining streaming scenarios still need a live pass.
8. Inspect AWS charges and Activate application history after billing updates. Confirm the model provider's specific charges are eligible for your grant.

### Claude Code through Bedrock (optional developer track)

Use organizational AWS SSO and a scoped Bedrock inference role for each developer. Configure the SSO profile locally, then use Claude Code's Amazon Bedrock setup wizard (`/setup-bedrock`) to verify access and pin model IDs. Your Kiro user subscription alone does not grant an AWS account permission set for CLI inference. An administrator must separately assign the appropriate account role. Avoid sharing a team member's static AWS keys.

Official references:
- https://code.claude.com/docs/en/amazon-bedrock
- https://kiro.dev/docs/web/
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-6.html
- https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html

## Modern workspace and model discovery update (23 November 2026)

The workspace refresh adds a BatteryPool identity, a document/code/data welcome screen, starter prompts that fill the composer, a wider message column and composer, file preview chips, visible focus styles, labelled icon actions, reduced motion support and a lighter navigation surface. The layout uses responsive CSS; desktop and mobile visual smoke tests must be completed on the deployed build.

The administrator-only `/admin/models` page reads Bedrock model summaries, active inference profiles and bounded availability checks using the **application execution role**. Results are cached for five minutes. Profile pagination is bounded to five pages and a warning identifies incomplete results. Metadata checks use up to four parallel workers and twelve models. `ACTIVE` profiles and available metadata are not labelled as successful inference. This endpoint never invokes a model, creates an agreement or changes workspace access.

The owner ran a CloudShell check in account 940880953077, us-east-1. Nova 2 Lite returned `OK` through `us.amazon.nova-2-lite-v1:0`. Claude Sonnet/Opus/Haiku 5.5 and GPT-6.2 Sol/Astra reported `AUTHORIZED`, entitlement and Region `AVAILABLE`, but agreement `NOT_AVAILABLE`; they were not invoked. These observations concern the CloudShell principal and do not replace an application-role smoke test. Latest models remain outside the workspace allowlist pending activation, adapter validation and inference tests.

Nova 2 Lite is now supported as `amazon-nova-2-lite`. It uses an existing geo/global inference profile according to deployment flags; the current us-east-1 deployment normally chooses global inference. Its integration keeps reasoning off and omits Nova 1-only request parameters. The output cap is 65,536 (normal workspace default remains 32,768). Original binary documents still require Claude in this application; extracted text works with Nova. Token cost figures are estimates using published standard global token rates and do not prove billing or credit eligibility.

### Reliability and privacy changes

- Frame payloads are split according to their serialized UTF-8 byte size, keeping the JSON envelope below the API Gateway limit even with Devanagari, emoji or escaped text.
- WebSocket success requires an explicit completion event. Premature disconnects fail visibly; connection, idle and total deadlines clear on completion/failure. The client does not automatically retry an interrupted generation, which could duplicate work or charges.
- Credentials, message frames and full conversation bodies are no longer emitted by the touched client/server log paths. Other upstream tools and account-level invocation logging need a separate review.
- Generic server failures return an opaque request ID and a safe message. Detailed stack traces remain server-side. Malformed Bearer headers are rejected.
- The configured workspace model allowlist is enforced on the server before loading conversation data; hiding a model only in the UI is insufficient.

### Deploying the update

The existing `CDK_JSON_OVERRIDE` replaces `globalAvailableModels`, so changing `cdk/cdk.json` alone will **not** enable Nova 2 Lite in this account. Preserve the override and append `amazon-nova-2-lite` explicitly. Keep the current Sonnet 4.6 default and existing title model. Do not bulk-enable all catalog models. Deploy backend and frontend together with the existing job. Verify the exact checkout SHA in build logs, then repeat authenticated chat, code, file upload, file history and original download tests.

Before describing the system as production-ready, also complete two-user isolation and deletion checks, load/latency testing, mobile/keyboard testing, operational alarms, backup/restore checks and a review of IAM, retention and provider agreement/credit eligibility. This change improves the application; it is not a production certification.

## UI reliability correction — 23 November 2026

The first modern workspace update introduced visible regressions. The production browser review reproduced white sidebar text on white backgrounds, obsolete dark gradient strips on conversation labels, and the model chooser opening beneath the message viewport where the composer clipped it. A browser zoom check also exposed cramped navigation and welcome content at a smaller effective viewport.

The correction restores explicit light/dark navigation colors and ordinary text truncation, separates link targets from rename/delete buttons, keeps the sidebar footer in layout, and provides a focus-managed mobile navigation dialog. Collapsed groups use `hidden` so their links are excluded from keyboard navigation. The settings menu now supports keyboard navigation and Escape.

The chat uses a bounded flex layout with one conversation scroll region and a separately bounded composer. The welcome content can grow and scroll from its top. A ResizeObserver follows asynchronous content growth only while the reader follows the latest message; wheel, touch and keyboard upward navigation pause it. Jump to latest resumes following. Queued frames and observers are cleaned up on unmount. Changing the internal ID when a new chat is saved does not reset the reader's scroll position.

The model chooser is a labelled portal dialog with focus restoration, independent of the conversation overflow. Draft attachment/image queues and long text input have bounded scroll areas. Regenerate/Continue actions remain in the composer layout instead of covering the conversation. Enter-to-send is handled only by the text field; activating a file control with Enter cannot submit the draft. Shift+Enter and IME composition retain their normal behavior. Preference storage failures do not crash the workspace, and theme changes synchronize desktop/mobile menus.

Validation: 48 frontend tests, including 19 new scroll, dialog, keyboard, composer and preference regression tests; TypeScript/production Vite build; lint with zero warnings. These DOM tests validate interactions, not rendered browser geometry.

Deployment status (24 November 2026): the owner confirmed successful deployment of application commit `fdc9347fe9f0604d03084d0c88e266d2f8e8cc40`. An authenticated production browser check verified readable sidebar labels, the model dialog and Escape, scrolling both directions in saved history, Jump to latest, and no horizontal page overflow. At 150% browser zoom, responsive navigation opened and closed and the composer remained reachable; zoom was restored afterward. This is not a real mobile-device/keyboard test. Reading older content during a fresh long stream, real mobile keyboards, dark-theme checks and broader operational tests remain outstanding.

## Stop generation and portable conversations — 24 November 2026

During a streaming request the send control becomes **Stop generation**. Stopping before authentication or the upload handshake completes avoids invoking the model. Once a request reaches the backend, an authenticated control message marks that socket's existing, user-owned DynamoDB session as cancelled. The running handler polls the record about once per second and passes a thread-safe cancellation signal to the pinned Strands SDK; the legacy Converse path closes its event stream. Duplicate END frames cannot start a second generation.

Stop is cooperative: model/network checkpoints and tools already executing can delay completion, and completed actions cannot be undone. Tokens/work processed before cancellation may still be billed; local usage estimates can be incomplete for interrupted streams. The UI shows Stopping until the backend confirms that the partial answer was persisted. A lost connection reports that cancellation could not be confirmed. New-chat navigation ignores late output from the previous view.

Visible partial text is saved with a stopped flag, survives history reload, and can be used in a follow-up. Incomplete reasoning signatures and tool-use blocks are removed before replaying stopped content to a provider. Stopped first requests use a prompt-derived title rather than starting another title-model call. Stop during the initial handshake leaves the prompt/files available locally for another send.

| Action | Content |
|---|---|
| Copy prompt | The user's message text |
| Copy answer as Markdown | All visible answer text blocks, preserving code, Unicode and citation markers |
| Copy request and response | The preceding user prompt and selected answer, with the same export options below |
| Export conversation | All user/assistant messages on the selected conversation path; alternate branches are excluded |
| Formats | Markdown, plain text or structured JSON, using Copy all or Download |
| Optional context | Complete available extracted attachment text and cited source excerpts |

The export preview is limited to 20,000 characters for responsiveness; Copy all and Download use the entire export without that preview cap. Attachment reads use the owner's authenticated endpoint, with at most three concurrent reads. The endpoint returns base64-encoded UTF-8 text to avoid JSON escaping inflation and disables caching. Exports whitelist the intended conversation fields and omit authentication state, raw S3 keys, temporary signed links, hidden instructions and internal reasoning. Explicitly pasted secrets in ordinary message/file text remain part of that text.

Images and original binary documents are listed with a reattachment notice, rather than embedded. Failed/deleted attachment reads are identified. This is a portable record of visible conversation and available file context, not an exact provider request or an automatic reconstruction of private bot instructions, all tool results, or every retrieval step. The receiving LLM's file and context limits still apply.

Validation: all 74 frontend tests pass; lint passes with zero warnings; TypeScript and the Vite production build pass. The existing large-bundle advisory remains. Forty-four targeted backend tests pass, including real pinned-SDK cancellation with a synthetic no-network model, persisted partial answers, authoritative completion events, cancellation ownership/duplicate protection, full-file export and attachment ownership. Existing Pydantic/legacy API deprecation warnings remain. No new AWS permissions or infrastructure resources are required for cancellation or export.

Deploy backend and frontend together using the newly pinned helper. The Stop/export change has not yet been deployed or live-smoke-tested. After deployment:

1. Start a long answer; stop while reasoning, during text and during a tool step. Wait for the confirmation, reload the conversation, verify partial text/stopped status, then send a follow-up. Stop cannot undo a tool action already completed.
2. Stop immediately after Send and send again with the same files. Verify no duplicate response, missing prompt or stale busy state. Open New chat during an answer and verify old output does not enter the new chat.
3. Copy a prompt, a code-containing answer, one request/response and the whole conversation. Export Markdown/text/JSON. Use an extracted file over 20,000 characters and verify its last line appears in Copy all and Download. Reattach binary originals in the destination LLM.
4. Verify another user cannot read the attachment-text endpoint; check missing/deleted files and blocked clipboard permissions. Copy failure must offer Download without reporting success.
5. Repeat scroll, model dialog and composer checks on desktop, narrow/zoomed layouts and a real mobile keyboard. Confirm all new actions remain reachable without horizontal overflow.

## Frontier models and employee usage controls — 24 November 2026

The authenticated production catalog was rechecked after AWS Support changed the account access. It reported access metadata available for Claude Opus 5.5 and GPT-6.2 Astra; Sonnet 5.5, Haiku 5.5 and GPT-6.2 Sol remained unconfirmed by metadata. AWS Console still returned Site Unavailable in the assistant's browser. No new account-level inference test or deployment was performed by the assistant in this release.

The reviewed integration includes these candidates:

| Workspace key | Bedrock foundation model ID |
|---|---|
| `claude-v5.5-sonnet` | `anthropic.claude-sonnet-5-5` |
| `claude-v5.5-opus` | `anthropic.claude-opus-5-5` |
| `claude-v5.5-haiku` | `anthropic.claude-haiku-5-5` |
| `gpt-6.2-sol` | `openai.gpt-6.2-sol` |
| `gpt-6.2-astra` | `openai.gpt-6.2-astra` |

Candidates are not exposed to employees just because an adapter exists or an inference profile is ACTIVE. After CodeBuild succeeds, rerunning the pinned deployment helper invokes a private, IAM-only diagnostic Lambda using the **same execution role as production WebSocket chat**. It sends a fixed, small prompt through the app's actual Strands adapter, checks streamed text and a reasoning-enabled follow-up turn, and stores only passing profiles in the model registry. These diagnostic calls can be billable. No arbitrary model/prompt inputs, subscription APIs or agreement APIs are exposed.

The diagnostic respects the deployment's global/US geographic inference flags. It does not fall back to global routing when that option is disabled. It stores the actual profile that passed and its source Region. If routing changes, stale incompatible registrations cannot be used. A lease prevents concurrent probe jobs; matching completed checks are reused. Use `--recheck-models` after a later AWS access change to rerun the bounded checks. If the app stack has a prefix, supply `--stack-name <actual-stack-name>`.

The helper preserves the live domain, authentication settings, default model and existing baseline model list. It checks the project/account/repository on every run, refuses another active deployment and uses a CodeBuild idempotency token for simultaneous starts. Failed model registration is reported separately from a successful infrastructure build. It requires the operator to be able to read the application stack outputs and invoke the private probe. It does not create deployment credentials or widen a user's IAM permissions.

Claude 5.5 uses model-specific reasoning requests: Opus always uses adaptive thinking; Sonnet's lower-thinking setting is `between_tools`; Haiku can disable thinking. Readable summaries use the supported display option. Unsupported sampling/prefill options are omitted. GPT-6.2 uses Converse streaming with optional reasoning summaries, omits unsupported explicit cache points and sampling controls, and preserves its opaque reasoning data while omitting readable summaries on replay. Original binary documents still require Claude in this app; extracted text works with the integrated OpenAI models. Output requests are bounded to 128,000 tokens; normal defaults remain 32,768 unless a lower policy/bot limit applies.

A response heartbeat keeps long reasoning/tool waits alive without resetting partial text or cancelling the conversation. Existing idle/total deadlines and explicit completion handling remain. Chat titles now derive locally from the first user prompt, avoiding an extra, unbounded title-model endpoint around usage controls.

### Configuring limits

Open **Admin → Usage limits** after deployment. No caps are imposed by default. Save the desired amounts; changes apply to newly admitted generations. **Your usage** in the chat header shows the selected model's current counters and caps.

| Scope | Controls |
|---|---|
| Entire workspace | Daily/monthly generation requests and output tokens per chat model call |
| Default for each employee | Daily/monthly requests and output ceiling |
| Individual employee email | Overrides for defaults; optional model allowlist |
| Each model across the workspace | Enable/disable, daily/monthly requests and output ceiling |
| Each employee on a model | Separate daily/monthly request cap for that model |

Blank means no additional cap. Individual employee blanks inherit the employee default. A request cap of zero blocks use. Shared workspace and model caps still apply even when an employee gets a larger personal allocation. Counters use the verified Cognito subject, so another browser tab or an email change does not reset usage. Email identifies the admin's policy override, not a new AWS/IAM/Kiro user.

Admission reserves all day/month counters in one DynamoDB transaction, with a policy-revision condition. Rejected reservations increment none of the counters. Policy changes during reservation are reloaded; competing admin saves return a conflict without dropping the unsaved draft. The request is rejected before retrieval or model/tool execution when a cap is reached. A lost/unavailable quota backend fails closed. The WebSocket execution environment also receives the baseline allowlist explicitly; both REST chat and streaming validate employee/model access on the server.

Request counts include admitted attempts that later fail or are stopped. Stop before backend admission does not count. A tool loop counts as one admitted generation; its chat model calls each receive the output ceiling, but remote tools/agents can have separate underlying usage. Titles use no model. Private diagnostic calls, published bot APIs and direct Bedrock/Kiro/other applications are outside these workspace counters. These controls are **not dollar budgets, monthly token budgets, or AWS-account-wide service quotas**. Token prices/context size/caching/tools still determine actual AWS charges. Cost analytics can exclude models without configured rates and incomplete streams; AWS Billing remains authoritative.

Periods roll over by their keys at midnight in `Asia/Kolkata` and on the first day of the month. DynamoDB TTL only cleans up counters after roughly 100 days; enforcement does not wait for TTL deletion. Counts start with this release and do not backfill earlier chat history. The dedicated table uses AWS-managed encryption, point-in-time recovery and Retain deletion policy. Roles receive access scoped to that table. The diagnostic has no public function URL or API Gateway route.

### Validation and remaining live checks

- 121 targeted backend tests and 32 subtests pass, including model parameters/profiles, summary replay, private probe registration/failure/caching/routing, quota rejection/concurrency contracts, policy changes, output ceilings, local titles, original attachment regressions and deployment-helper guards.
- 84 frontend tests pass, including editing/saving caps, conflict recovery, employee override drafts, fresh private usage reads, empty access/loading policies, remembered-model changes, heartbeats, existing Stop/export and workspace controls. Lint has zero warnings; TypeScript/Vite production build passes.
- 66 CDK tests and TypeScript build pass. CDK assertions synthesize with dependency bundling skipped; the AWS deployment still packages dependencies through the existing CodeBuild job. Tests verify retention/encryption/PITR/TTL, shared chat/probe role, baseline allowlist wiring and absence of public probe invocation permissions.
- Local quota concurrency tests use a no-network transaction fixture and verify the all-or-nothing client contract; the deployed DynamoDB/IAM path still needs its live check. Model adapter unit tests do not prove account entitlement.

After the helper reports a successful build and completed frontier checks, refresh the app/catalog. Verify each enabled model can stream, stop, reload its partial answer and continue with files; the private probe already tests a reasoning-enabled follow-up. Set a small temporary test employee cap, send concurrently from two tabs, verify the precise boundary/other-model behavior, then restore the intended allocation. Verify model allowlist changes, employee isolation, admin-only policy writes and narrow/mobile layout. Real mobile keyboard, broader load/latency, backup/restore and operational-readiness gates remain.

Sources used for the integration:
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-2-sol.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-2-astra.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html
