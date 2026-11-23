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
7. Test mobile-width layout, keyboard navigation, IME entry, dark mode and a long streaming code block. The coding agent's remote browser could not reach the local Storybook preview; a visual browser pass remains necessary.
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
