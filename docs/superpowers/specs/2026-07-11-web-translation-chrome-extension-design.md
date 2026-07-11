# Web Translation Chrome Extension Design

Date: 2026-07-11
Status: Approved design, pending written-spec review

## 1. Product Goal

Build a Chrome Manifest V3 extension with two translation modes:

1. Translate ordinary English web pages into Chinese while preserving the original page layout and interactions.
2. Replace the active PDF viewer with a custom bilingual paper-reading workspace intended primarily for arXiv papers.

The PDF workspace must preserve the original address-bar URL and must re-render every PDF with PDF.js whenever PDF translation is enabled. It must not silently fall back to Chrome's native PDF viewer. The initial version calls MinerU and an OpenAI-compatible API directly from the extension. A separate backend may be added later behind stable provider interfaces.

## 2. Confirmed Requirements

### 2.1 Translation providers

- Users configure an OpenAI-compatible base URL, model name, and API key.
- Users configure a MinerU token for precision PDF parsing.
- Translation, chat, and MinerU integrations are isolated behind provider interfaces so a future backend can replace direct calls without changing the reader UI.

### 2.2 PDF scope and hard constraints

- Support arXiv PDFs, arbitrary public HTTP/HTTPS PDFs, authenticated PDFs that depend on browser cookies, redirected PDFs, and local `file://` PDFs.
- Chrome's "Allow access to file URLs" permission is required for local PDFs.
- When PDF translation is enabled, the extension must replace the PDF display with a PDF.js-based reader.
- The address-bar URL must remain byte-for-byte identical to the original PDF URL, including query parameters and fragments, throughout activation, reading, refresh, forward/back navigation, and deactivation.
- Native Chrome PDF rendering is not an accepted fallback while translation is enabled.
- These requirements are subject to a Phase 0 technical feasibility gate described in section 10.

### 2.3 PDF reading experience

- Use a two-column reading layout: PDF.js-rendered PDF on the left and Chinese translation on the right.
- Organize translation by original PDF page.
- Synchronize the two columns using page and paragraph-block anchors.
- Prioritize translation of the current page, then adjacent pages, then the remainder of the document.
- Preserve formulas, tables, figures, captions, headings, and page references in the normalized document model.
- Provide a collapsible agent panel at the far right. Collapsing it returns space to the translation column.

### 2.4 Agent behavior

- The initial agent receives the complete MinerU-parsed document as fixed conversation context.
- Each request additionally includes the active page, selected text, and recent conversation turns.
- Answers cite source page numbers; clicking a page citation navigates both reader columns.
- If the full paper exceeds the configured model's context allowance, the extension must not silently truncate it. It creates a chapter-level compression plus the full active-page text and informs the user that compressed context is being used.
- Vector search, embeddings, and server-side RAG are intentionally excluded from the initial version.

### 2.5 Ordinary webpage experience

- Translate English text into Chinese in place while preserving the original DOM structure, links, controls, and page behavior.
- Let the user reveal original text by hover or keyboard shortcut.
- Support one-click restoration of the original page.
- Prioritize visible content and translate additional content as it approaches the viewport.
- Observe dynamically inserted content for infinite-scroll and single-page applications.

## 3. Architecture

The extension is divided into independently testable units with explicit message contracts.

### 3.1 Extension service worker

Responsibilities:

- Detect supported PDF navigation and coordinate activation/deactivation.
- Request optional host and file URL permissions.
- Fetch remote PDF bytes using the active browser session where permissions allow.
- Coordinate MinerU and OpenAI-compatible requests.
- Persist task metadata and recover interrupted asynchronous work.
- Route messages between content scripts, the PDF workspace, settings, and provider adapters.

The service worker does not own UI state and does not assume it remains alive between events.

### 3.2 PDF Takeover Adapter

Responsibilities:

- Replace the current PDF presentation without changing its address-bar URL.
- Mount and unmount the workspace in the current tab.
- Preserve refresh, forward/back, original-link copying, and deactivation semantics.
- Expose the original PDF bytes or a readable byte source to PDF.js and the parsing pipeline.
- Report an explicit unsupported error when the hard takeover conditions cannot be met.

This unit is the primary subject of the Phase 0 feasibility gate. Its implementation mechanism is deliberately not predetermined because Chrome's protected PDF viewer behavior must be verified experimentally.

### 3.3 PDF workspace

The workspace contains:

- A top toolbar for page navigation, zoom, search, translation state, original-text display, and settings.
- A left PDF.js viewer.
- A right translated-page stream.
- A resizable and collapsible agent panel.
- Resizable separators between all visible columns.

It consumes a normalized `DocumentModel` rather than MinerU-specific response objects.

### 3.4 MinerU Provider

Responsibilities:

- Submit URL-based precision extraction tasks for accessible remote files.
- Use MinerU's file-upload workflow for local PDFs and remote PDFs that MinerU cannot fetch directly.
- Poll asynchronous tasks with cancellation, timeout, and bounded retry behavior.
- Normalize Markdown/JSON extraction artifacts into `DocumentModel`.
- Retain page indices from MinerU content-list output as the canonical mapping source.

MinerU supports precision parsing with formulas, tables, structured output, and asynchronous task polling. The provider must remain compatible with the documented URL task and upload task workflows rather than assuming direct file upload to the single-file URL endpoint.

### 3.5 Translation Provider and Scheduler

The OpenAI-compatible translation provider accepts semantic page blocks and returns translations keyed by stable block identifiers. The scheduler:

- Places the active page at highest priority.
- Places the immediately previous and next pages at second priority.
- Processes remaining pages in reading order.
- Batches small compatible blocks without crossing page identity.
- Limits concurrency and observes provider rate-limit responses.
- Stores partial success so one failed page does not invalidate the document.

### 3.6 Agent Context Builder

The context builder creates a stable prompt package containing:

- Complete normalized paper text when it fits.
- Active page and selected block metadata.
- Recent conversation turns within a fixed budget.
- Explicit page anchors used for citations.

When compression is necessary, it replaces only the non-active portions with chapter summaries and records that fact in the UI.

### 3.7 Webpage Translation Content Script

Responsibilities:

- Discover translatable text nodes with a DOM walker.
- Exclude scripts, styles, inputs, editable regions, code/preformatted blocks, and extension-owned UI.
- Group nodes into semantic batches.
- Replace text without replacing parent elements or event-bound DOM.
- Maintain a stable original/translated node map.
- Observe new content with `MutationObserver` while preventing self-triggered loops.
- Restore all original text and remove extension metadata on deactivation.

### 3.8 Storage

- `chrome.storage.local`: provider settings, non-secret preferences, task references, and small session metadata.
- IndexedDB: PDF content hashes, normalized document models, per-page translations, conversation state, and reading positions.
- Cache keys include the PDF content hash, source and target languages, provider identity, model identity, and prompt/schema version.

API keys and tokens are stored only in `chrome.storage.local`. The UI must clearly state that this is local extension storage, not an operating-system credential vault.

## 4. Core Data Model

`DocumentModel` is the boundary between parsing, rendering, translation, and agent features. It contains:

- Document identity, source URL, content hash, title, and page count.
- Ordered pages with stable page identifiers.
- Ordered blocks per page with stable block identifiers.
- Block type: heading, paragraph, list, formula, table, figure, caption, footnote, or other.
- Original text, optional LaTeX/HTML representation, resource references, and source geometry when available.
- Translation state and translated content kept outside the immutable source fields.

No consumer reads raw MinerU response shapes directly.

## 5. PDF Data Flow

1. The user explicitly enables PDF translation for the active tab.
2. The Takeover Adapter validates that the document can be replaced while retaining the original URL.
3. The adapter obtains the PDF byte stream and mounts the workspace.
4. PDF.js renders the left column immediately; MinerU completion is not required for basic reading.
5. The MinerU Provider computes or receives the document identity, checks the local cache, and submits a parsing task when necessary.
6. The task controller polls until completion, cancellation, failure, or timeout.
7. The provider converts the result into `DocumentModel` and persists it.
8. The scheduler translates the active page, neighboring pages, and then remaining pages.
9. The translated stream renders completed page blocks incrementally.
10. The agent becomes available after the normalized document is ready. It may answer while background translation is still running.

## 6. Page Synchronization

- Each PDF page and translated page owns the same stable page anchor.
- When the user scrolls one column, the synchronization controller selects the dominant visible page and aligns the other column to that page.
- Block-level alignment is used only when reliable block geometry exists.
- Direct user interaction in the destination column temporarily suspends automatic following to avoid scroll contention.
- A visible "Resync" action restores automatic alignment.
- Page navigation, search results, and agent citations use the same navigation command so both columns remain consistent.

## 7. Failure Handling

- PDF.js rendering and MinerU parsing fail independently. A MinerU failure leaves the re-rendered PDF readable and provides retry and diagnostic actions in the translation column.
- Page translation failures are isolated per page and can be retried individually or as a group.
- Network errors, rate limits, and transient server failures use bounded exponential backoff with visible status.
- Authentication errors stop immediately and direct the user to settings.
- Task state is persisted so service-worker suspension or browser restart can resume polling safely.
- Deactivation restores the native document presentation at the same URL and best-effort reading position.
- A takeover failure never redirects to an extension URL and never presents the native viewer as translated mode.

## 8. Privacy and Security

- No PDF, webpage text, or conversation content is sent until the user enables the relevant feature.
- Before uploading a local or authenticated PDF to MinerU, the UI identifies the destination service and requests confirmation.
- Provider credentials never enter page DOM, console logs, exported diagnostics, or prompt content.
- Extension UI is isolated from host-page CSS and JavaScript.
- Remote code is not loaded; all executable code ships in the extension package as required by Manifest V3.
- Cache entries can be deleted per document or globally.
- Webpage translation is not automatically enabled on password, payment, browser-internal, or administrative pages.

## 9. Deliberate Initial-Version Exclusions

- Self-hosted backend service.
- User accounts or cross-device synchronization.
- Vector database, embeddings, or server-side RAG.
- Collaborative notes and annotations.
- OCR or document parsing engines other than MinerU.
- Languages other than English-to-Chinese in the primary UX, although interfaces must not hard-code the pair.
- Automatic translation of every visited page.

## 10. Phase 0: PDF Takeover Go/No-Go Gate

Implementation must begin with a minimal technical probe, not the full product UI.

### 10.1 Test matrix

- An arXiv PDF URL.
- A direct public HTTPS PDF.
- A PDF reached through redirects and query parameters.
- A PDF requiring browser cookies.
- A local `file://` PDF with file URL access enabled.
- Refresh, forward, back, duplicate tab, copy URL, and open in a new tab.
- Activation and deactivation while preserving the exact address-bar URL.

### 10.2 Pass criteria

Every sample must:

- Keep the byte-for-byte exact original address-bar URL, including query parameters and fragments.
- Display a demonstrably PDF.js-rendered test surface after activation.
- Survive refresh and history navigation with correct enablement semantics.
- Allow the original PDF bytes to be read by the extension.
- Restore native viewing on deactivation.

### 10.3 Failure policy

If any required class of PDF cannot meet the criteria, PDF implementation stops. The project returns to product design to revise at least one hard constraint. It does not proceed with a hidden URL change, native-viewer fallback, or reduced PDF scope.

## 11. Testing Strategy

### 11.1 Unit tests

- MinerU response normalization into `DocumentModel`.
- Stable page and block identifiers.
- Translation scheduling and reprioritization.
- Context budgeting and compression disclosure.
- Cache key generation and invalidation.
- Bounded retry and task recovery logic.
- Webpage node filtering, replacement, and restoration.

### 11.2 Integration tests

- Provider adapters against recorded, sanitized responses.
- IndexedDB persistence and interrupted-task recovery.
- PDF page/translation synchronization commands.
- Webpage dynamic-content translation without observer loops.

### 11.3 Browser end-to-end tests

- The complete Phase 0 URL-preserving takeover matrix.
- PDF activation, rendering, parsing, incremental translation, agent questions, citations, and deactivation.
- Ordinary page activation, viewport-priority translation, hover original, dynamic insertion, and restoration.
- Settings validation, permission prompts, invalid credentials, rate limits, and cache clearing.

## 12. MVP Acceptance Criteria

- The Phase 0 gate passes for all required PDF classes.
- Enabling PDF translation always produces a PDF.js-rendered workspace without changing the original URL.
- The PDF and translation columns stay aligned by page and recover from manual-scroll suspension.
- Current-page translation appears before full-document translation completes.
- Formulas, tables, figures, headings, captions, and page identity survive MinerU normalization.
- The agent can answer from the complete paper context and produces navigable page citations.
- Ordinary pages translate in place, preserve interactions, handle dynamic content, reveal original text, and restore cleanly.
- Provider configuration, resumable tasks, local caching, error reporting, retry, and cache deletion work as specified.
- Automated tests cover the critical data model, scheduling, provider, caching, DOM translation, and browser workflows.

## 13. References

- Chrome Extensions content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome `scripting` API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome Manifest V3 overview: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- MinerU API overview and limits: https://mineru.net/doc/docs/index_en/
- MinerU API documentation: https://mineru.net/apiManage/docs
- MinerU project documentation: https://github.com/opendatalab/MinerU
