/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
 *
 * Design decisions (BUILD mode, UX-for-AI + Design-for-AI):
 *
 * FOUNDATION (Ch. 1–5):
 *   Ch.1 Gulf of Execution: three-screen progressive setup — each screen has
 *     exactly one primary action. No ambiguity about what to do next.
 *   Ch.1 Gulf of Evaluation: every save shows loading → success/error inline.
 *     Buttons change text. Errors appear next to the field that caused them.
 *   Ch.2 Discoverability: buttons look pressable (filled, border, hover lift).
 *     Inputs have visible labels above them, never placeholder-only.
 *     Clickable capability cards have hover background + chevron.
 *   Ch.3 Feedback: optimistic UI on saves. Button text changes to "saving…"
 *     within 100ms. Success/error state persists 2s then resets.
 *     Inline field errors animate in. Toast for global messages.
 *   Ch.4 Mental models: "Connect Slack" not "configure slack.botToken".
 *     "Model" not "bedrock.modelId". User language throughout.
 *     Screens map to the user's mental journey: connect → configure → manage.
 *   Ch.5 Constraints & forgiveness: delete requires inline confirm with the
 *     key name. Tokens are password fields with reveal. Forms validate on blur,
 *     not on keystroke. Next button disabled until required fields filled.
 *
 * JOY (Ch. 6–8):
 *   Ch.6 Visceral: warm industrial aesthetic — deep navy base, warm amber
 *     accent, silver neutral. NOT cyan-on-dark (AI tell). NOT Inter (AI tell).
 *     System font stack with -apple-system leading. 3:4 proportional scale.
 *     One dominant element per screen (the primary CTA). Generous white space.
 *   Ch.7 Behavioral: hot path is one click per save. Keyboard-navigable.
 *     Micro-interactions: button scale on active (97%), toggle slides smoothly,
 *     chevron rotates on expand. All 100ms micro / 220ms standard / 300ms complex.
 *     Ease-out-expo for entries, ease-in-out for toggles.
 *   Ch.8 Reflective: first-success moment — after Slack connects, a warm
 *     "tino is connected" banner appears. After full setup, the console header
 *     shows a live status dot. The peak moment (first working deploy) is
 *     celebrated with specific copy, not generic "Success!".
 *
 * Design identity: "warm butler" — dark navy suit, amber glove, silver cloche.
 *   Specific enough that someone could disagree with it. Not AI default.
 *
 * Proportional system: 3:4 (×0.75)
 *   Spacing scale: 4 6 8 12 16 21 28 37px
 *   Type scale: 11 14 19 25px (body at 14px)
 *
 * Color palette (analogous warm-cool split):
 *   bg-deep:    #141c27  deepest background
 *   bg-base:    #1a2332  page background — dark navy
 *   bg-raised:  #1f2b3d  card surface
 *   bg-inset:   #162030  input / inset surface
 *   border:     #2a3a50  structural borders
 *   border-sub: #223040  subtle dividers
 *   text-prim:  #f2ebe3  warm primary text (bumped contrast)
 *   text-sec:   #9aa6b8  cool secondary — recedes
 *   text-dim:   #5a6a7e  dimmed / placeholder
 *   accent:     #c8956a  warm amber — butler's glove
 *   accent-dim: #7a4e2a  darker accent for borders
 *   silver:     #a8b0bc  silver cloche — neutral highlights
 *   ok:         #6aab7a  success green — muted, not neon
 *   err:        #c06060  error red — warm, not harsh
 */
export function getConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/assets/tino-logo.png">
  <title>tino — console</title>
  <style>
    /* ── Reset ─────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Design tokens ──────────────────────────────────────────────────── */
    :root {
      --bg-deep:    #141c27;
      --bg-base:    #1a2332;
      --bg-raised:  #1f2b3d;
      --bg-inset:   #162030;
      --border:     #2a3a50;
      --border-sub: #223040;
     --text-prim:  #f2ebe3;
     --text-sec:   #9aa6b8;
     --text-dim:   #5a6a7e;
      --accent:     #c8956a;
      --accent-dim: #7a4e2a;
      --silver:     #a8b0bc;
      --ok:         #6aab7a;
      --err:        #c06060;
      --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --radius:    6px;
      --radius-sm: 4px;
      /* Easing curves — ease-out-expo for entries, ease-in-out for toggles */
      --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
      --ease-io:   cubic-bezier(0.65, 0, 0.35, 1);
      --ease-in:   cubic-bezier(0.7, 0, 0.84, 0);
    }

    /* ── Base ───────────────────────────────────────────────────────────── */
    html { font-size: 14px; }
    body {
      font-family: var(--sans);
      font-size: 1rem;
      line-height: 1.5;
      background: var(--bg-base);
      color: var(--text-prim);
      min-height: 100dvh;
    }

    /* ── Layout ─────────────────────────────────────────────────────────── */
    .page {
      max-width: 720px;
      margin: 0 auto;
      padding: clamp(16px, 4vw, 28px);
    }

    /* ── Screen visibility ──────────────────────────────────────────────── */
    .screen { display: none; }
    .screen.active { display: block; }

    /* ── Logo block (setup screens) ─────────────────────────────────────── */
    .logo-block {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 37px;
    }
    .logo-img {
      width: 40px;
      height: 40px;
      border-radius: var(--radius);
      flex-shrink: 0;
    }
    .logo-wordmark {
      font-size: clamp(1.2rem, 1.357rem, 1.5rem);
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.01em;
    }

    /* ── Setup screen container ─────────────────────────────────────────── */
    .setup-screen { max-width: 480px; }

    /* Step indicator — shows progress through setup */
    .setup-steps {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 28px;
    }
    .setup-step {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--border);
      transition: background 300ms var(--ease-out), transform 300ms var(--ease-out);
    }
    .setup-step.active {
      background: var(--accent);
      transform: scale(1.4);
    }
    .setup-step.done { background: var(--ok); }
    .setup-step-label {
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-left: 4px;
    }

    .setup-heading {
      font-size: clamp(1.5rem, 1.714rem, 2rem);
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.02em;
      margin-bottom: 8px;
      line-height: 1.2;
    }
    .setup-lead {
      font-size: 1rem;
      color: var(--text-sec);
      line-height: 1.6;
      margin-bottom: 28px;
    }

    /* ── Success banner ─────────────────────────────────────────────────── */
    /* Ch.8 reflective: first-success moment — specific, not generic */
    .success-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: rgba(106, 171, 122, 0.08);
      border: 1px solid rgba(106, 171, 122, 0.25);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 28px;
      font-size: 0.929rem;
      color: var(--ok);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 300ms var(--ease-out), transform 300ms var(--ease-out);
    }
    .success-banner.visible { opacity: 1; transform: translateY(0); }
    .success-banner-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
    .success-banner-body { flex: 1; }
    .success-banner-title { font-weight: 600; margin-bottom: 2px; }
    .success-banner-sub { font-size: 0.857rem; color: rgba(106, 171, 122, 0.75); }

    /* ── Form field group ───────────────────────────────────────────────── */
    /* Ch.2: labels above inputs — never placeholder-only */
    .field-group { margin-bottom: 16px; }
    .field-label {
      display: block;
      font-size: 0.857rem;
      font-weight: 500;
      color: var(--text-prim);
      margin-bottom: 5px;
    }
    .field-label-mono {
      font-family: var(--mono);
      font-size: 0.786rem;
      color: var(--silver);
    }
    .field-input-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .field-input {
      flex: 1;
      min-width: 0;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-prim);
      font-family: var(--mono);
      font-size: 0.857rem;
      padding: 8px 10px;
      outline: none;
      /* Ch.3: 100ms micro-interaction for focus feedback */
      transition: border-color 100ms, box-shadow 100ms;
      min-height: 44px; /* Ch.2 + responsive.md: 44px touch target */
      width: 100%;
    }
    .field-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    .field-input:hover:not(:focus-visible):not([aria-invalid="true"]) {
      border-color: #3a4e68;
    }
    .field-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }
    .field-input.field-success {
      border-color: var(--ok);
      box-shadow: 0 0 0 2px rgba(106, 171, 122, 0.2);
    }
    .field-input:disabled { opacity: 0.5; cursor: not-allowed; }
    .field-input::placeholder { color: var(--text-dim); }

    /* Helper text */
    .field-hint {
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-top: 4px;
      line-height: 1.5;
    }

    /* Inline error — animates in (Ch.3: errors appear next to the field) */
    .field-error {
      font-size: 0.786rem;
      color: var(--err);
      margin-top: 4px;
      line-height: 1.4;
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);
      pointer-events: none;
    }
    .field-error.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    /* Reveal button for token fields */
    .reveal-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-dim);
      cursor: pointer;
      padding: 7px 10px;
      font-size: 0.786rem;
      font-family: var(--sans);
      line-height: 1;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      min-height: 44px;
      min-width: 48px;
      transition: color 100ms, border-color 100ms, background 100ms;
    }
    .reveal-btn:hover { color: var(--silver); border-color: #3a4e68; background: rgba(168,176,188,0.05); }
    .reveal-btn:active { transform: scale(0.97); }
    .reveal-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* ── Buttons ────────────────────────────────────────────────────────── */
    /* Ch.2: buttons look pressable — filled, border, hover lift */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-sec);
      font-family: var(--sans);
      font-size: 0.857rem;
      padding: 8px 14px;
      cursor: pointer;
      transition: background 100ms, border-color 100ms, color 100ms,
                  transform 100ms, opacity 100ms;
      min-height: 44px;
      min-width: 44px;
      white-space: nowrap;
    }
    .btn:hover:not(:disabled):not(.saving) {
      background: var(--bg-raised);
      border-color: #3a4e68;
      color: var(--text-prim);
    }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* Ch.7: scale on active — tactile micro-interaction */
    .btn:active:not(:disabled):not(.saving) { transform: scale(0.97); }
    .btn:disabled, .btn[aria-disabled="true"] {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Primary — warm amber, one per screen (Ch.6: one dominant CTA) */
    .btn-primary {
      background: rgba(200, 149, 106, 0.1);
      border-color: var(--accent-dim);
      color: var(--accent);
      font-weight: 500;
    }
    .btn-primary:hover:not(:disabled):not(.saving) {
      background: rgba(200, 149, 106, 0.18);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Large primary — setup screens */
    .btn-primary-lg {
      font-size: 0.929rem;
      padding: 10px 20px;
      min-height: 48px;
    }

    /* Loading state — Ch.3: button text changes, pointer becomes wait */
    .btn.saving {
      opacity: 0.65;
      cursor: wait;
      pointer-events: none;
    }

    /* Success state */
    .btn.saved {
      background: rgba(106, 171, 122, 0.12);
      border-color: rgba(106, 171, 122, 0.5);
      color: var(--ok);
    }

    /* Error state */
    .btn.save-error {
      background: rgba(192, 96, 96, 0.1);
      border-color: rgba(192, 96, 96, 0.5);
      color: var(--err);
    }

    /* Danger */
    .btn-danger {
      color: var(--err);
      border-color: rgba(192, 96, 96, 0.3);
    }
    .btn-danger:hover:not(:disabled) {
      background: rgba(192, 96, 96, 0.08);
      border-color: var(--err);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    /* Ghost link */
    .btn-ghost {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 0.857rem;
      cursor: pointer;
      padding: 4px 0;
      font-family: var(--sans);
      text-decoration: underline;
      text-underline-offset: 2px;
      transition: color 100ms;
    }
    .btn-ghost:hover { color: var(--text-sec); }
    .btn-ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Divider ────────────────────────────────────────────────────────── */
    .divider {
      border: none;
      border-top: 1px solid var(--border-sub);
      margin: 28px 0;
    }

    /* ── Help block ─────────────────────────────────────────────────────── */
    .help-block {
      font-size: 0.857rem;
      color: var(--text-dim);
      line-height: 1.6;
    }
    .help-block a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(200, 149, 106, 0.3);
      transition: border-color 100ms, color 100ms;
    }
    .help-block a:hover { color: var(--text-prim); border-color: var(--text-prim); }
    .help-block a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Step list ──────────────────────────────────────────────────────── */
    .step-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .step-list li {
      display: flex;
      gap: 8px;
      font-size: 0.857rem;
      color: var(--text-dim);
      line-height: 1.5;
    }
    .step-num {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      font-size: 0.714rem;
      font-weight: 600;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 2px;
    }

    /* ── Console header ─────────────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 21px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 21px;
    }
    .header-logo {
      width: 36px;
      height: 36px;
      border-radius: var(--radius);
      flex-shrink: 0;
    }
    .header-wordmark {
      font-size: clamp(1.1rem, 1.357rem, 1.5rem);
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.01em;
    }
    .header-sub {
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-top: 1px;
    }
    .header-status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.786rem;
      color: var(--text-dim);
    }
    /* Ch.8: live status dot — the peak moment of "it's working" */
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-dim);
      flex-shrink: 0;
    }
    .status-dot.ok { background: var(--ok); }

    /* ── Section labels ─────────────────────────────────────────────────── */
    /* Ch.7 visual hierarchy: uppercase label, generous space above */
    .section-label {
      font-size: 0.786rem;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    /* ── Capability grid ────────────────────────────────────────────────── */
    /* Mobile-first: single column, expands at content breakpoint */
    .cap-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-bottom: 28px;
    }
    @media (min-width: 520px) {
      .cap-grid { grid-template-columns: repeat(2, 1fr); }
    }

    /* ── Capability card ────────────────────────────────────────────────── */
    /* Ch.6: foreground/background depth — card lifts on hover */
    .cap-card {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 150ms;
    }
    .cap-card.state-ok   { border-left: 3px solid var(--ok); }
    .cap-card.state-warn { border-left: 3px solid var(--err); }
    .cap-card.state-disabled { border-left: 3px solid var(--border); }

    .cap-card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 14px 10px;
      cursor: pointer;
      user-select: none;
      transition: background 100ms;
    }
    .cap-card-header:hover { background: rgba(200, 149, 106, 0.04); }
    .cap-card-header:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .cap-card-icon {
      font-size: 1.286rem;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .cap-card-meta { flex: 1; min-width: 0; }
    .cap-card-name {
      font-size: 0.929rem;
      font-weight: 600;
      color: var(--text-prim);
      margin-bottom: 2px;
    }
    .cap-card-desc {
      font-size: 0.786rem;
      color: var(--text-sec);
      line-height: 1.4;
    }

    .cap-card-status {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .status-connected {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.714rem;
      color: var(--ok);
      font-weight: 500;
    }

    .btn-setup {
      font-size: 0.786rem;
      padding: 4px 10px;
      min-height: 36px;
    }

    /* ── Toggle switch ──────────────────────────────────────────────────── */
    /* Ch.7: smooth slide — ease-in-out, 150ms */
    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toggle {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
    }
    .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle-track {
      position: absolute;
      inset: 0;
      background: var(--border);
      border-radius: 18px;
      cursor: pointer;
      transition: background 150ms var(--ease-io);
    }
    .toggle:hover .toggle-track { background: #3a4e68; }
    .toggle input:checked ~ .toggle-track { background: var(--accent-dim); }
    .toggle input:checked:hover ~ .toggle-track { background: #9a6040; }
    .toggle:active .toggle-track { transform: scale(0.96); }
    .toggle input:disabled ~ .toggle-track { opacity: 0.4; cursor: not-allowed; }
    .toggle input:disabled ~ .toggle-thumb { opacity: 0.4; cursor: not-allowed; }
    .toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 12px;
      height: 12px;
      background: var(--text-dim);
      border-radius: 50%;
      transition: transform 150ms var(--ease-io), background 150ms var(--ease-io);
      pointer-events: none;
    }
    .toggle input:checked ~ .toggle-thumb {
      transform: translateX(14px);
      background: var(--accent);
    }
    .toggle input:focus-visible ~ .toggle-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Expand chevron ─────────────────────────────────────────────────── */
    .cap-chevron {
      width: 14px;
      height: 14px;
      color: var(--text-dim);
      flex-shrink: 0;
      transition: transform 200ms var(--ease-io);
      margin-top: 3px;
    }
    .cap-card.open .cap-chevron { transform: rotate(90deg); }

    /* ── Card detail expand/collapse ────────────────────────────────────── */
    /* grid-template-rows trick: no layout-triggering height animation */
    .cap-detail-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms var(--ease-out);
    }
    .cap-card.open .cap-detail-wrap { grid-template-rows: 1fr; }
    .cap-detail-inner { overflow: hidden; }
    .cap-detail {
      padding: 0 14px 14px 14px;
      border-top: 1px solid var(--border-sub);
    }

    /* Detail sections */
    .detail-section { margin-top: 14px; }
    .detail-section:first-child { margin-top: 12px; }
    .detail-label {
      font-size: 0.714rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    /* findWork section */
    .fw-row {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }
    .fw-toggle-group {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 2px;
    }
    .fw-label { font-size: 0.857rem; color: var(--text-sec); }
    .fw-interval-group { flex: 1; min-width: 120px; }
    .fw-interval-label { display: block; font-size: 0.786rem; color: var(--text-dim); margin-bottom: 4px; }
    .fw-interval-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.786rem;
      color: var(--text-dim);
    }
    .fw-interval-input {
      width: 60px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-prim);
      font-family: var(--mono);
      font-size: 0.786rem;
      padding: 5px 6px;
      text-align: center;
      min-height: 36px;
      outline: none;
      transition: border-color 100ms, box-shadow 100ms;
    }
    .fw-interval-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    .fw-interval-input:hover:not(:focus-visible) { border-color: #3a4e68; }
    .fw-interval-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }

    /* ── Empty state ────────────────────────────────────────────────────── */
    /* Ch.5: empty states teach the interface, not just say "nothing here" */
    .empty { color: var(--text-dim); font-size: 0.857rem; font-style: italic; padding: 8px 0; }
    .empty-state { padding: 10px 0 4px; }
    .empty-state-msg {
      font-size: 0.857rem;
      color: var(--text-sec);
      line-height: 1.5;
      margin-bottom: 6px;
    }
    .empty-state-link {
      font-size: 0.786rem;
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(200, 149, 106, 0.3);
      transition: border-color 100ms, color 100ms;
    }
    .empty-state-link:hover { color: var(--text-prim); border-color: var(--text-prim); }
    .empty-state-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Raw config section ─────────────────────────────────────────────── */
    .raw-section { margin-bottom: 28px; }
    .raw-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      color: var(--text-dim);
      font-size: 0.786rem;
      font-weight: 500;
      margin-bottom: 12px;
      background: none;
      border: none;
      padding: 4px 0;
      min-height: 44px;
      transition: color 100ms;
    }
    .raw-toggle:hover { color: var(--text-sec); }
    .raw-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
    .raw-chevron {
      width: 12px;
      height: 12px;
      transition: transform 200ms var(--ease-io);
    }
    .raw-section.open .raw-chevron { transform: rotate(90deg); }
    .raw-body-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms var(--ease-out);
    }
    .raw-section.open .raw-body-wrap { grid-template-rows: 1fr; }
    .raw-body-inner { overflow: hidden; }
    .raw-body { padding-bottom: 4px; }

    /* Add entry form */
    .add-form { display: flex; flex-direction: column; gap: 10px; }
    .add-form-fields {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-end;
    }
    .add-form-fields .field-group {
      flex: 1;
      min-width: 120px;
      margin-bottom: 0;
    }

    /* ── Config table ───────────────────────────────────────────────────── */
    /* Ch.7: no unnecessary rule lines (Tufte 1+1=3) — alignment does the work */
    .config-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.786rem;
      margin-bottom: 16px;
    }
    .config-table th {
      text-align: left;
      padding: 0 8px 8px 0;
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.714rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-sub);
    }
    .config-table td {
      padding: 7px 8px 7px 0;
      border-bottom: 1px solid var(--border-sub);
      vertical-align: middle;
    }
    .config-table tr:last-child td { border-bottom: none; }
    .config-table .col-key { font-family: var(--mono); color: var(--silver); white-space: nowrap; padding-right: 16px; }
    .config-table .col-val { font-family: var(--mono); color: var(--text-sec); word-break: break-all; }
    .config-table .col-ts  { color: var(--text-dim); white-space: nowrap; padding-right: 12px; }
    .config-table .col-act { white-space: nowrap; }

    /* Inline delete confirmation — Ch.5: named destructive confirm */
    .delete-confirm {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      opacity: 0;
      transform: translateX(8px);
      transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
      pointer-events: none;
      position: absolute;
      right: 0;
      top: 50%;
      translate: 0 -50%;
      background: var(--bg-raised);
      border: 1px solid rgba(192, 96, 96, 0.3);
      border-radius: var(--radius-sm);
      padding: 3px 6px;
      white-space: nowrap;
      z-index: 10;
    }
    .delete-confirm.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
    .col-act { position: relative; }
    .delete-confirm-text { font-size: 0.714rem; color: var(--err); }
    .delete-confirm-yes {
      background: none; border: none; color: var(--err); font-size: 0.714rem; font-weight: 600;
      cursor: pointer; padding: 2px 4px; border-radius: 2px; min-height: 28px; min-width: 44px;
    }
    .delete-confirm-yes:hover { background: rgba(192, 96, 96, 0.12); }
    .delete-confirm-yes:focus-visible { outline: 2px solid var(--err); outline-offset: 1px; }
    .delete-confirm-no {
      background: none; border: none; color: var(--text-dim); font-size: 0.714rem;
      cursor: pointer; padding: 2px 4px; border-radius: 2px; min-height: 28px; min-width: 44px;
    }
    .delete-confirm-no:hover { color: var(--text-sec); }
    .delete-confirm-no:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

    /* ── Compliance section ─────────────────────────────────────────────── */
    .compliance-section { margin-bottom: 28px; }
    .compliance-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      color: var(--text-dim);
      font-size: 0.786rem;
      font-weight: 500;
      margin-bottom: 12px;
      background: none;
      border: none;
      padding: 4px 0;
      min-height: 44px;
      transition: color 100ms;
    }
    .compliance-toggle:hover { color: var(--text-sec); }
    .compliance-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
    .compliance-chevron {
      width: 12px;
      height: 12px;
      transition: transform 200ms var(--ease-io);
    }
    .compliance-section.open .compliance-chevron { transform: rotate(90deg); }
    .compliance-body-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms var(--ease-out);
    }
    .compliance-section.open .compliance-body-wrap { grid-template-rows: 1fr; }
    .compliance-body-inner { overflow: hidden; }
    .compliance-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.786rem;
    }
    .compliance-table th {
      text-align: left;
      padding: 0 8px 8px 0;
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.714rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-sub);
    }
    .compliance-table td {
      padding: 7px 8px 7px 0;
      border-bottom: 1px solid var(--border-sub);
      vertical-align: middle;
    }
    .compliance-table tr:last-child td { border-bottom: none; }
    .compliance-table .col-service { font-family: var(--mono); color: var(--silver); white-space: nowrap; padding-right: 16px; }
    .compliance-table .col-status  { white-space: nowrap; }
    .compliance-table .col-detail  { color: var(--text-sec); font-size: 0.714rem; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.714rem;
      font-family: var(--mono);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .status-ok   { background: rgba(106, 171, 122, 0.12); color: var(--ok); }
    .status-warn { background: rgba(200, 149, 106, 0.12); color: var(--accent); }
    .status-err  { background: rgba(192, 96, 96, 0.12);   color: var(--err); }
    .status-dim  { background: rgba(168, 176, 188, 0.1);  color: var(--silver); }
    .compliance-loading { color: var(--text-dim); font-size: 0.857rem; font-style: italic; padding: 8px 0; }

    /* ── Signed-in user indicator ──────────────────────────────────────── */
    .header-user {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-left: auto;
    }
    .header-user-email {
      color: var(--text-sec);
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-user-sep {
      color: var(--border);
    }
    .header-signout {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 0.786rem;
      font-family: var(--sans);
      cursor: pointer;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 2px;
      transition: color 100ms;
    }
    .header-signout:hover { color: var(--text-sec); }
    .header-signout:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Health footer ──────────────────────────────────────────────────── */
    .health-footer {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid var(--border-sub);
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .health-uptime { font-size: 0.714rem; color: var(--text-dim); }
    .health-tools  { font-size: 0.714rem; color: var(--text-dim); }
    .health-tools strong { color: var(--text-sec); font-weight: 500; }

    /* ── Toast ──────────────────────────────────────────────────────────── */
    /* Ch.3: loud success, polite failure */
    #toast {
      position: fixed;
      bottom: 21px;
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 16px;
      font-size: 0.857rem;
      color: var(--text-sec);
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
      white-space: nowrap;
      z-index: 100;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
    #toast.ok  { border-color: var(--ok);  color: var(--ok); }
    #toast.err { border-color: var(--err); color: var(--err); }
    #toast-undo {
      background: none; border: none; color: inherit; font: inherit; font-weight: 600;
      cursor: pointer; padding: 0 0 0 10px; text-decoration: underline; opacity: 0.85;
    }
    #toast-undo:hover { opacity: 1; }
    #toast-undo:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px; }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    /* Mobile-first: min-width queries add complexity, never strip it */
    @media (max-width: 480px) {
      .config-table .col-ts { display: none; }
      .add-form-fields { flex-direction: column; }
      .add-form-fields .field-group { width: 100%; }
      .fw-row { flex-direction: column; gap: 10px; }
    }

    /* ── Reduced motion ─────────────────────────────────────────────────── */
    /* motion.md: critical accessibility requirement */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- ── Screen 1: Welcome ────────────────────────────────────────────── -->
    <!-- Ch.1: one job — connect Slack. Nothing else on this screen. -->
    <div id="screen-welcome" class="screen">
      <div class="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" class="logo-img">
        <span class="logo-wordmark">tino</span>
      </div>
      <div class="setup-screen">
        <!-- Step indicator: 1 of 3 -->
        <div class="setup-steps" aria-label="Setup progress: step 1 of 3">
          <div class="setup-step active" aria-current="step"></div>
          <div class="setup-step"></div>
          <div class="setup-step"></div>
          <span class="setup-step-label">step 1 of 3</span>
        </div>

        <h1 class="setup-heading">connect Slack.</h1>
        <p class="setup-lead">
          tino lives in Slack. give it your bot and app tokens
          and it'll be ready to take requests in under a minute.
        </p>

        <div class="field-group">
          <label class="field-label" for="slack-bot-token">
            Bot Token
            <span class="field-label-mono">xoxb-…</span>
          </label>
          <div class="field-input-wrap">
            <input class="field-input" type="password" id="slack-bot-token"
                   placeholder="xoxb-…"
                   autocomplete="off"
                   aria-describedby="slack-bot-token-hint slack-bot-token-error"
                   onblur="validateSlackToken('slack-bot-token', 'xoxb-', 'slack-bot-token-error')">
            <button class="reveal-btn" type="button"
                    onclick="toggleReveal('slack-bot-token', this)"
                    aria-label="Reveal Bot Token">show</button>
          </div>
          <div class="field-hint" id="slack-bot-token-hint">
            Slack → your app → OAuth &amp; Permissions → Bot User OAuth Token
          </div>
          <div class="field-error" id="slack-bot-token-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="field-group">
          <label class="field-label" for="slack-app-token">
            App Token
            <span class="field-label-mono">xapp-…</span>
          </label>
          <div class="field-input-wrap">
            <input class="field-input" type="password" id="slack-app-token"
                   placeholder="xapp-…"
                   autocomplete="off"
                   aria-describedby="slack-app-token-hint slack-app-token-error"
                   onblur="validateSlackToken('slack-app-token', 'xapp-', 'slack-app-token-error')">
            <button class="reveal-btn" type="button"
                    onclick="toggleReveal('slack-app-token', this)"
                    aria-label="Reveal App Token">show</button>
          </div>
          <div class="field-hint" id="slack-app-token-hint">
            Slack → your app → Basic Information → App-Level Tokens (connections:write scope)
          </div>
          <div class="field-error" id="slack-app-token-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="btn-row">
          <!-- Ch.6: one dominant CTA per screen -->
          <button class="btn btn-primary btn-primary-lg" id="btn-connect-slack"
                  onclick="saveSlack()"
                  aria-describedby="connect-slack-status">
            connect Slack
          </button>
          <span id="connect-slack-status" class="field-hint" style="margin-top:0"></span>
        </div>

        <hr class="divider">
        <div class="help-block">
          <p>need help finding your tokens?</p>
          <ol class="step-list" style="margin-top:8px">
            <li><span class="step-num">1</span><span>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> and open your app</span></li>
            <li><span class="step-num">2</span><span>OAuth &amp; Permissions → Bot User OAuth Token (xoxb-)</span></li>
            <li><span class="step-num">3</span><span>Basic Information → App-Level Tokens → create one with <code>connections:write</code></span></li>
          </ol>
        </div>
      </div>
    </div>

    <!-- ── Screen 2: Basics ──────────────────────────────────────────────── -->
    <!-- Ch.1: Slack done, now model + admin. Two fields, one action. -->
    <div id="screen-basics" class="screen">
      <div class="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" class="logo-img">
        <span class="logo-wordmark">tino</span>
      </div>
      <div class="setup-screen">
        <!-- Step indicator: 2 of 3 -->
        <div class="setup-steps" aria-label="Setup progress: step 2 of 3">
          <div class="setup-step done"></div>
          <div class="setup-step active" aria-current="step"></div>
          <div class="setup-step"></div>
          <span class="setup-step-label">step 2 of 3</span>
        </div>

        <!-- Ch.8: first-success moment — Slack is connected -->
        <div class="success-banner" id="slack-connected-banner" role="status">
          <span class="success-banner-icon">✓</span>
          <div class="success-banner-body">
            <div class="success-banner-title">Slack connected.</div>
            <div class="success-banner-sub">tino can now receive messages from your workspace.</div>
          </div>
        </div>

        <h1 class="setup-heading">configure the agent.</h1>
        <p class="setup-lead">
          two more things: which Bedrock model to use, and your Slack user ID
          so tino knows who the admin is.
        </p>

        <div class="field-group">
          <label class="field-label" for="bedrock-model-id">
            Bedrock Model ID
          </label>
          <input class="field-input" type="text" id="bedrock-model-id"
                 placeholder="us.anthropic.claude-sonnet-4-5-20251101-v1:0"
                 autocomplete="off"
                 aria-describedby="bedrock-model-hint bedrock-model-error"
                 onblur="validateRequired('bedrock-model-id', 'bedrock-model-error', 'Model ID is required')">
          <div class="field-hint" id="bedrock-model-hint">
            The cross-region inference profile ID from your AWS Bedrock console.
          </div>
          <div class="field-error" id="bedrock-model-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="field-group">
          <label class="field-label" for="admin-user-id">
            Your Slack User ID
          </label>
          <input class="field-input" type="text" id="admin-user-id"
                 placeholder="U0123456789"
                 autocomplete="off"
                 aria-describedby="admin-user-hint admin-user-error"
                 onblur="validateRequired('admin-user-id', 'admin-user-error', 'User ID is required')">
          <div class="field-hint" id="admin-user-hint">
            Slack → your profile → ⋯ → Copy member ID. Starts with U.
          </div>
          <div class="field-error" id="admin-user-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="btn-row">
          <button class="btn btn-primary btn-primary-lg" id="btn-save-basics"
                  onclick="saveBasics()">
            finish setup
          </button>
          <button class="btn-ghost" onclick="showScreen('screen-welcome')">← back</button>
        </div>
      </div>
    </div>

    <!-- ── Screen 3: Console ─────────────────────────────────────────────── -->
    <!-- Ch.8: the peak moment — tino is fully configured and running -->
    <div id="screen-console" class="screen">

      <header class="header">
        <img src="/assets/tino-logo.png" alt="tino" class="header-logo">
        <div>
          <div class="header-wordmark">tino</div>
          <div class="header-sub">personal assistant</div>
        </div>
        <div class="header-status" id="header-status" aria-live="polite">
          <div class="status-dot" id="status-dot"></div>
          <span id="status-text">checking…</span>
        </div>
        <!-- Signed-in user indicator — populated by JS if session info is available -->
        <div class="header-user" id="header-user" style="display:none" aria-live="polite">
          <span class="header-user-email" id="header-user-email"></span>
          <span class="header-user-sep">·</span>
          <button class="header-signout" onclick="signOut()" type="button">sign out</button>
        </div>
      </header>

      <!-- ── Capabilities ──────────────────────────────────────────────── -->
      <div class="section-label">capabilities</div>
      <div class="cap-grid" id="cap-grid">
        <!-- populated by JS -->
      </div>

      <!-- ── Core config ───────────────────────────────────────────────── -->
      <div class="section-label">core config</div>
      <div class="cap-grid" style="margin-bottom:28px">

        <!-- Slack card -->
        <div class="cap-card" id="card-slack">
          <div class="cap-card-header" role="button" tabindex="0"
               aria-expanded="false" aria-controls="detail-slack"
               onclick="toggleCard('card-slack','detail-slack')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCard('card-slack','detail-slack')}">
            <span class="cap-card-icon">💬</span>
            <div class="cap-card-meta">
              <div class="cap-card-name">Slack</div>
              <div class="cap-card-desc">bot + app tokens</div>
            </div>
            <div class="cap-card-status">
              <span class="status-connected" id="slack-status-badge">● connected</span>
            </div>
            <svg class="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cap-detail-wrap">
            <div class="cap-detail-inner">
              <div class="cap-detail" id="detail-slack">
                <div class="detail-section">
                  <div class="detail-label">Bot Token</div>
                  <div class="field-group" style="margin-bottom:8px">
                    <div class="field-input-wrap">
                      <input class="field-input" type="password" id="edit-slack-bot"
                             autocomplete="off"
                             aria-label="Slack Bot Token"
                             aria-describedby="edit-slack-bot-error"
                             onblur="validateSlackToken('edit-slack-bot','xoxb-','edit-slack-bot-error')">
                      <button class="reveal-btn" type="button"
                              onclick="toggleReveal('edit-slack-bot',this)"
                              aria-label="Reveal Bot Token">show</button>
                    </div>
                    <div class="field-error" id="edit-slack-bot-error" role="alert" aria-live="polite"></div>
                  </div>
                </div>
                <div class="detail-section">
                  <div class="detail-label">App Token</div>
                  <div class="field-group" style="margin-bottom:8px">
                    <div class="field-input-wrap">
                      <input class="field-input" type="password" id="edit-slack-app"
                             autocomplete="off"
                             aria-label="Slack App Token"
                             aria-describedby="edit-slack-app-error"
                             onblur="validateSlackToken('edit-slack-app','xapp-','edit-slack-app-error')">
                      <button class="reveal-btn" type="button"
                              onclick="toggleReveal('edit-slack-app',this)"
                              aria-label="Reveal App Token">show</button>
                    </div>
                    <div class="field-error" id="edit-slack-app-error" role="alert" aria-live="polite"></div>
                  </div>
                </div>
                <div class="btn-row">
                  <button class="btn btn-primary btn-setup" id="btn-save-slack"
                          onclick="saveSlackEdit()">save tokens</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Agent card -->
        <div class="cap-card" id="card-agent">
          <div class="cap-card-header" role="button" tabindex="0"
               aria-expanded="false" aria-controls="detail-agent"
               onclick="toggleCard('card-agent','detail-agent')"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCard('card-agent','detail-agent')}">
            <span class="cap-card-icon">🤖</span>
            <div class="cap-card-meta">
              <div class="cap-card-name">Agent</div>
              <div class="cap-card-desc">model + admin user</div>
            </div>
            <div class="cap-card-status">
              <span class="status-connected" id="agent-status-badge">● configured</span>
            </div>
            <svg class="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cap-detail-wrap">
            <div class="cap-detail-inner">
              <div class="cap-detail" id="detail-agent">
                <div class="detail-section">
                  <div class="detail-label">Bedrock Model ID</div>
                  <div class="field-group" style="margin-bottom:8px">
                    <input class="field-input" type="text" id="edit-model-id"
                           autocomplete="off"
                           aria-label="Bedrock Model ID"
                           aria-describedby="edit-model-error"
                           onblur="validateRequired('edit-model-id','edit-model-error','Model ID is required')">
                    <div class="field-error" id="edit-model-error" role="alert" aria-live="polite"></div>
                  </div>
                </div>
                <div class="detail-section">
                  <div class="detail-label">Admin User ID</div>
                  <div class="field-group" style="margin-bottom:8px">
                    <input class="field-input" type="text" id="edit-admin-id"
                           autocomplete="off"
                           aria-label="Admin Slack User ID"
                           aria-describedby="edit-admin-error"
                           onblur="validateRequired('edit-admin-id','edit-admin-error','User ID is required')">
                    <div class="field-error" id="edit-admin-error" role="alert" aria-live="polite"></div>
                  </div>
                </div>
                <div class="btn-row">
                  <button class="btn btn-primary btn-setup" id="btn-save-agent"
                          onclick="saveAgentEdit()">save</button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div><!-- /core config grid -->

      <!-- ── Raw config ────────────────────────────────────────────────── -->
      <div class="raw-section" id="raw-section">
        <button class="raw-toggle" onclick="toggleRaw()" aria-expanded="false"
                aria-controls="raw-body-wrap" id="raw-toggle-btn">
          <svg class="raw-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          all config entries
        </button>
        <div class="raw-body-wrap" id="raw-body-wrap">
          <div class="raw-body-inner">
            <div class="raw-body">
              <table class="config-table" id="config-table">
                <thead>
                  <tr>
                    <th class="col-key">key</th>
                    <th class="col-val">value</th>
                    <th class="col-ts">updated</th>
                    <th class="col-act"></th>
                  </tr>
                </thead>
                <tbody id="config-tbody">
                  <tr><td colspan="4" class="empty">loading…</td></tr>
                </tbody>
              </table>

              <!-- Add entry form -->
              <div class="add-form">
                <div class="add-form-fields">
                  <div class="field-group">
                    <label class="field-label" for="new-key">Key</label>
                    <input class="field-input" type="text" id="new-key"
                           placeholder="config.key"
                           autocomplete="off"
                           aria-describedby="new-key-error">
                    <div class="field-error" id="new-key-error" role="alert" aria-live="polite"></div>
                  </div>
                  <div class="field-group">
                    <label class="field-label" for="new-val">Value</label>
                    <input class="field-input" type="text" id="new-val"
                           placeholder="value"
                           autocomplete="off">
                  </div>
                </div>
                <div class="btn-row" style="margin-top:4px">
                  <button class="btn btn-primary btn-setup" id="btn-add-entry"
                          onclick="addConfigEntry()">add entry</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Compliance ────────────────────────────────────────────────── -->
      <div class="compliance-section" id="compliance-section">
        <button class="compliance-toggle" onclick="toggleCompliance()" aria-expanded="false"
                aria-controls="compliance-body-wrap" id="compliance-toggle-btn">
          <svg class="compliance-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          compliance status
        </button>
        <div class="compliance-body-wrap" id="compliance-body-wrap">
          <div class="compliance-body-inner">
            <div id="compliance-content">
              <p class="compliance-loading">loading…</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Health footer ─────────────────────────────────────────────── -->
      <footer class="health-footer" id="health-footer">
        <span class="health-uptime" id="health-uptime"></span>
        <span class="health-tools" id="health-tools"></span>
      </footer>

    </div><!-- /screen-console -->

  </div><!-- /page -->

  <!-- ── Toast ──────────────────────────────────────────────────────────── -->
  <div id="toast" role="status" aria-live="polite">
    <span id="toast-msg"></span>
    <button id="toast-undo" style="display:none" onclick="undoDelete()">undo</button>
  </div>

  <script>
  /* ── Utilities ──────────────────────────────────────────────────────── */

  let toastTimer = null;
  function showToast(msg, type = '', undoFn = null) {
    const t = document.getElementById('toast');
    const m = document.getElementById('toast-msg');
    const u = document.getElementById('toast-undo');
    m.textContent = msg;
    t.className = type ? 'show ' + type : 'show';
    u.style.display = undoFn ? 'inline' : 'none';
    u._undoFn = undoFn || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, undoFn ? 5000 : 2500);
  }
  function undoDelete() {
    const u = document.getElementById('toast-undo');
    if (u._undoFn) u._undoFn();
    document.getElementById('toast').className = '';
  }

  /* ── Screen routing ─────────────────────────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  /* ── Validation ─────────────────────────────────────────────────────── */
  /* Ch.3: validate on blur, not on keystroke */
  function setFieldError(inputId, errorId, msg) {
    const inp = document.getElementById(inputId);
    const err = document.getElementById(errorId);
    if (!inp || !err) return;
    if (msg) {
      inp.setAttribute('aria-invalid', 'true');
      err.textContent = msg;
      err.classList.add('visible');
    } else {
      inp.removeAttribute('aria-invalid');
      err.textContent = '';
      err.classList.remove('visible');
    }
  }

  function validateSlackToken(inputId, prefix, errorId) {
    const val = (document.getElementById(inputId)?.value || '').trim();
    if (!val) { setFieldError(inputId, errorId, 'Token is required.'); return false; }
    if (!val.startsWith(prefix)) {
      setFieldError(inputId, errorId, \`Token must start with \${prefix}\`);
      return false;
    }
    setFieldError(inputId, errorId, '');
    return true;
  }

  function validateRequired(inputId, errorId, msg) {
    const val = (document.getElementById(inputId)?.value || '').trim();
    if (!val) { setFieldError(inputId, errorId, msg); return false; }
    setFieldError(inputId, errorId, '');
    return true;
  }

  /* ── Button state helpers ───────────────────────────────────────────── */
  /* Ch.3: button text changes within 100ms of click */
  function setBtnLoading(btnId, label = 'saving…') {
    const b = document.getElementById(btnId);
    if (!b) return;
    b._origText = b.textContent;
    b.textContent = label;
    b.classList.add('saving');
    b.disabled = true;
  }
  function setBtnSuccess(btnId, label = '✓ saved') {
    const b = document.getElementById(btnId);
    if (!b) return;
    b.textContent = label;
    b.classList.remove('saving');
    b.classList.add('saved');
    b.disabled = false;
    setTimeout(() => {
      b.textContent = b._origText || 'save';
      b.classList.remove('saved');
    }, 2000);
  }
  function setBtnError(btnId, label = 'error — retry') {
    const b = document.getElementById(btnId);
    if (!b) return;
    b.textContent = label;
    b.classList.remove('saving');
    b.classList.add('save-error');
    b.disabled = false;
    setTimeout(() => {
      b.textContent = b._origText || 'save';
      b.classList.remove('save-error');
    }, 3000);
  }

  /* ── API helpers ────────────────────────────────────────────────────── */
  async function putConfig(key, value) {
    const r = await fetch('/api/config/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function deleteConfig(key) {
    const r = await fetch('/api/config/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
  }

  async function getConfig() {
    const r = await fetch('/api/config');
    if (r.status === 401) { window.location.reload(); return []; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function getHealth() {
    const r = await fetch('/api/health');
    if (r.status === 401) { window.location.reload(); return {}; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function getCompliance() {
    const r = await fetch('/api/compliance');
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function getCapabilities() {
    const r = await fetch('/api/capabilities');
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function putCapability(id, data) {
    const r = await fetch('/api/capabilities/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  /* ── Screen 1: Connect Slack ────────────────────────────────────────── */
  async function saveSlack() {
    const botOk = validateSlackToken('slack-bot-token', 'xoxb-', 'slack-bot-token-error');
    const appOk = validateSlackToken('slack-app-token', 'xapp-', 'slack-app-token-error');
    if (!botOk || !appOk) return;

    const bot = document.getElementById('slack-bot-token').value.trim();
    const app = document.getElementById('slack-app-token').value.trim();

    setBtnLoading('btn-connect-slack', 'connecting…');
    try {
      await putConfig('slack.botToken', bot);
      await putConfig('slack.appToken', app);
      setBtnSuccess('btn-connect-slack', '✓ connected');
      // Ch.8: first-success moment — show the banner on the next screen
      setTimeout(() => {
        const banner = document.getElementById('slack-connected-banner');
        if (banner) {
          banner.classList.add('visible');
        }
        showScreen('screen-basics');
      }, 600);
    } catch (e) {
      setBtnError('btn-connect-slack', 'failed — retry');
      showToast('Could not save tokens: ' + e.message, 'err');
    }
  }

  /* ── Screen 2: Basics ───────────────────────────────────────────────── */
  async function saveBasics() {
    const modelOk = validateRequired('bedrock-model-id', 'bedrock-model-error', 'Model ID is required');
    const adminOk = validateRequired('admin-user-id', 'admin-user-error', 'User ID is required');
    if (!modelOk || !adminOk) return;

    const model = document.getElementById('bedrock-model-id').value.trim();
    const admin = document.getElementById('admin-user-id').value.trim();

    setBtnLoading('btn-save-basics', 'saving…');
    try {
      await putConfig('bedrock.modelId', model);
      await putConfig('slack.adminUserId', admin);
      setBtnSuccess('btn-save-basics', '✓ done');
      setTimeout(() => {
        initConsole();
        showScreen('screen-console');
      }, 700);
    } catch (e) {
      setBtnError('btn-save-basics', 'failed — retry');
      showToast('Could not save config: ' + e.message, 'err');
    }
  }

  /* ── Toggle reveal ──────────────────────────────────────────────────── */
  function toggleReveal(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const isHidden = inp.type === 'password';
    inp.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'hide' : 'show';
    btn.setAttribute('aria-label', (isHidden ? 'Hide' : 'Reveal') + ' token');
  }

  /* ── Card expand/collapse ───────────────────────────────────────────── */
  function toggleCard(cardId, detailId) {
    const card = document.getElementById(cardId);
    const header = card?.querySelector('.cap-card-header');
    if (!card) return;
    const isOpen = card.classList.toggle('open');
    if (header) header.setAttribute('aria-expanded', String(isOpen));
  }

  /* ── Raw config toggle ──────────────────────────────────────────────── */
  function toggleRaw() {
    const sec = document.getElementById('raw-section');
    const btn = document.getElementById('raw-toggle-btn');
    const isOpen = sec.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) loadConfigTable();
  }

  /* ── Compliance toggle ──────────────────────────────────────────────── */
  function toggleCompliance() {
    const sec = document.getElementById('compliance-section');
    const btn = document.getElementById('compliance-toggle-btn');
    const isOpen = sec.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) loadCompliance();
  }

  /* ── Config table ───────────────────────────────────────────────────── */
  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = Math.floor((now - d) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return d.toLocaleDateString();
    } catch { return '—'; }
  }

  function maskVal(key, val) {
    const sensitive = ['token', 'secret', 'password', 'key', 'credential'];
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      return val ? '••••••••' : '—';
    }
    return val || '—';
  }

  let _lastDeleteKey = null;
  let _lastDeleteVal = null;

  async function loadConfigTable() {
    const tbody = document.getElementById('config-tbody');
    if (!tbody) return;
    try {
      const entries = await getConfig();
      if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">no config entries yet</td></tr>';
        return;
      }
      tbody.innerHTML = entries.map(e => \`
        <tr>
          <td class="col-key">\${esc(e.key)}</td>
          <td class="col-val">\${esc(maskVal(e.key, e.value))}</td>
          <td class="col-ts">\${fmtTs(e.updatedAt)}</td>
          <td class="col-act">
            <button class="btn btn-danger btn-setup" style="font-size:0.714rem;padding:3px 8px;min-height:28px"
                    onclick="confirmDelete('\${esc(e.key)}', this)"
                    aria-label="Delete \${esc(e.key)}">delete</button>
            <div class="delete-confirm" id="dc-\${esc(e.key).replace(/\\./g,'-')}">
              <span class="delete-confirm-text">delete \${esc(e.key)}?</span>
              <button class="delete-confirm-yes" onclick="doDelete('\${esc(e.key)}')">yes</button>
              <button class="delete-confirm-no" onclick="cancelDelete('\${esc(e.key)}')">no</button>
            </div>
          </td>
        </tr>
      \`).join('');
    } catch (e) {
      tbody.innerHTML = \`<tr><td colspan="4" class="empty">error loading config: \${esc(e.message)}</td></tr>\`;
    }
  }

  function confirmDelete(key, btn) {
    // hide any other open confirms
    document.querySelectorAll('.delete-confirm.visible').forEach(d => d.classList.remove('visible'));
    const dcId = 'dc-' + key.replace(/\\./g, '-');
    const dc = document.getElementById(dcId);
    if (dc) dc.classList.add('visible');
  }

  function cancelDelete(key) {
    const dcId = 'dc-' + key.replace(/\\./g, '-');
    const dc = document.getElementById(dcId);
    if (dc) dc.classList.remove('visible');
  }

  async function doDelete(key) {
    cancelDelete(key);
    // Ch.5: soft delete with undo — store the value for recovery
    try {
      const entries = await getConfig();
      const entry = entries.find(e => e.key === key);
      _lastDeleteKey = key;
      _lastDeleteVal = entry?.value || null;
      await deleteConfig(key);
      loadConfigTable();
      showToast('deleted ' + key, 'ok', async () => {
        if (_lastDeleteKey && _lastDeleteVal !== null) {
          await putConfig(_lastDeleteKey, _lastDeleteVal);
          loadConfigTable();
          showToast('restored ' + _lastDeleteKey, 'ok');
        }
      });
    } catch (e) {
      showToast('delete failed: ' + e.message, 'err');
    }
  }

  async function addConfigEntry() {
    const keyEl = document.getElementById('new-key');
    const valEl = document.getElementById('new-val');
    const key = keyEl?.value.trim();
    const val = valEl?.value.trim();
    if (!key) {
      setFieldError('new-key', 'new-key-error', 'Key is required');
      return;
    }
    setFieldError('new-key', 'new-key-error', '');
    setBtnLoading('btn-add-entry', 'adding…');
    try {
      await putConfig(key, val);
      keyEl.value = '';
      valEl.value = '';
      setBtnSuccess('btn-add-entry', '✓ added');
      loadConfigTable();
    } catch (e) {
      setBtnError('btn-add-entry', 'failed');
      showToast('Could not add entry: ' + e.message, 'err');
    }
  }

  /* ── Compliance ─────────────────────────────────────────────────────── */
  async function loadCompliance() {
    const el = document.getElementById('compliance-content');
    if (!el) return;
    try {
      const data = await getCompliance();
      if (!data || !data.services || !data.services.length) {
        el.innerHTML = '<p class="compliance-loading">no compliance data available</p>';
        return;
      }
      el.innerHTML = \`
        <table class="compliance-table">
          <thead>
            <tr>
              <th class="col-service">service</th>
              <th class="col-status">status</th>
              <th class="col-detail">detail</th>
            </tr>
          </thead>
          <tbody>
            \${data.services.map(s => {
              const cls = s.status === 'ok' ? 'status-ok'
                        : s.status === 'warn' ? 'status-warn'
                        : s.status === 'error' ? 'status-err'
                        : 'status-dim';
              return \`<tr>
                <td class="col-service">\${esc(s.name)}</td>
                <td class="col-status"><span class="status-badge \${cls}">\${esc(s.status)}</span></td>
                <td class="col-detail">\${esc(s.detail || '')}</td>
              </tr>\`;
            }).join('')}
          </tbody>
        </table>
      \`;
    } catch (e) {
      el.innerHTML = \`<p class="compliance-loading">error: \${esc(e.message)}</p>\`;
    }
  }

  /* ── Health ─────────────────────────────────────────────────────────── */
  async function loadHealth() {
    try {
      const h = await getHealth();
      const dot = document.getElementById('status-dot');
      const txt = document.getElementById('status-text');
      const uptime = document.getElementById('health-uptime');
      const tools = document.getElementById('health-tools');

      if (h.ok) {
        dot?.classList.add('ok');
        if (txt) txt.textContent = 'running';
      } else {
        if (txt) txt.textContent = 'degraded';
      }

      if (uptime && h.uptime != null) {
        const s = Math.floor(h.uptime);
        const m = Math.floor(s / 60);
        const hrs = Math.floor(m / 60);
        uptime.textContent = hrs > 0
          ? \`up \${hrs}h \${m % 60}m\`
          : m > 0 ? \`up \${m}m\` : \`up \${s}s\`;
      }

      if (tools && h.tools != null) {
        tools.innerHTML = \`<strong>\${h.tools}</strong> tools loaded\`;
      }
    } catch {
      const txt = document.getElementById('status-text');
      if (txt) txt.textContent = 'unreachable';
    }
  }

  /* ── Capability grid ────────────────────────────────────────────────── */
  const CAP_META = {
    github:     { icon: '🐙', name: 'GitHub',     desc: 'repos, issues, PRs' },
    calendar:   { icon: '📅', name: 'Calendar',   desc: 'Google Calendar events' },
    gmail:      { icon: '✉️',  name: 'Gmail',      desc: 'read and send email' },
    linear:     { icon: '📐', name: 'Linear',     desc: 'issues and projects' },
    cloudwatch: { icon: '☁️',  name: 'CloudWatch', desc: 'AWS logs and metrics' },
    slack:      { icon: '💬', name: 'Slack read', desc: 'read channel history' },
  };

  async function loadCapabilities() {
    const grid = document.getElementById('cap-grid');
    if (!grid) return;
    try {
      const caps = await getCapabilities();
      if (!caps || !caps.length) {
        grid.innerHTML = '<p class="empty">no capabilities configured</p>';
        return;
      }
      grid.innerHTML = caps.map(cap => {
        const meta = CAP_META[cap.id] || { icon: '⚙️', name: cap.id, desc: '' };
        const isEnabled = cap.enabled !== false;
        const stateClass = isEnabled ? 'state-ok' : 'state-disabled';
        const cardId = 'cap-card-' + cap.id;
        const detailId = 'cap-detail-' + cap.id;

        // Build fields for this capability
        const fields = buildCapFields(cap);

        return \`
          <div class="cap-card \${stateClass}" id="\${cardId}">
            <div class="cap-card-header" role="button" tabindex="0"
                 aria-expanded="false" aria-controls="\${detailId}"
                 onclick="toggleCard('\${cardId}','\${detailId}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCard('\${cardId}','\${detailId}')}">
              <span class="cap-card-icon">\${meta.icon}</span>
              <div class="cap-card-meta">
                <div class="cap-card-name">\${esc(meta.name)}</div>
                <div class="cap-card-desc">\${esc(meta.desc)}</div>
              </div>
              <div class="cap-card-status">
                \${isEnabled
                  ? '<span class="status-connected">● on</span>'
                  : '<span style="font-size:0.714rem;color:var(--text-dim)">off</span>'}
              </div>
              <svg class="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="cap-detail-wrap">
              <div class="cap-detail-inner">
                <div class="cap-detail" id="\${detailId}">
                  <div class="detail-section">
                    <div class="toggle-wrap">
                      <label class="toggle" aria-label="Enable \${esc(meta.name)}">
                        <input type="checkbox" \${isEnabled ? 'checked' : ''}
                               onchange="toggleCapability('\${esc(cap.id)}', this.checked)">
                        <div class="toggle-track"></div>
                        <div class="toggle-thumb"></div>
                      </label>
                      <span class="fw-label">enabled</span>
                    </div>
                  </div>
                  \${fields}
                  <div class="btn-row">
                    <button class="btn btn-primary btn-setup" id="btn-save-cap-\${esc(cap.id)}"
                            onclick="saveCapability('\${esc(cap.id)}')">save</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    } catch (e) {
      grid.innerHTML = \`<p class="empty">error loading capabilities: \${esc(e.message)}</p>\`;
    }
  }

  function buildCapFields(cap) {
    if (!cap.fields || !cap.fields.length) return '';
    return cap.fields.map(f => \`
      <div class="detail-section">
        <div class="detail-label">\${esc(f.label || f.key)}</div>
        <div class="field-group" style="margin-bottom:4px">
          <input class="field-input" type="\${f.secret ? 'password' : 'text'}"
                 id="cap-field-\${esc(cap.id)}-\${esc(f.key)}"
                 value="\${esc(f.value || '')}"
                 placeholder="\${esc(f.placeholder || '')}"
                 autocomplete="off"
                 aria-label="\${esc(f.label || f.key)}">
        </div>
      </div>
    \`).join('');
  }

  async function toggleCapability(id, enabled) {
    try {
      await putCapability(id, { enabled });
      // Update card state class
      const card = document.getElementById('cap-card-' + id);
      if (card) {
        card.classList.remove('state-ok', 'state-disabled', 'state-warn');
        card.classList.add(enabled ? 'state-ok' : 'state-disabled');
      }
    } catch (e) {
      showToast('Could not update capability: ' + e.message, 'err');
    }
  }

  async function saveCapability(id) {
    const btnId = 'btn-save-cap-' + id;
    setBtnLoading(btnId, 'saving…');
    try {
      // Collect field values
      const fields = {};
      document.querySelectorAll('[id^="cap-field-' + id + '-"]').forEach(inp => {
        const key = inp.id.replace('cap-field-' + id + '-', '');
        fields[key] = inp.value.trim();
      });
      // Get enabled state
      const card = document.getElementById('cap-card-' + id);
      const toggle = card?.querySelector('input[type="checkbox"]');
      await putCapability(id, { enabled: toggle?.checked ?? true, fields });
      setBtnSuccess(btnId, '✓ saved');
    } catch (e) {
      setBtnError(btnId, 'failed');
      showToast('Could not save: ' + e.message, 'err');
    }
  }

  /* ── Console: edit Slack tokens ─────────────────────────────────────── */
  async function saveSlackEdit() {
    const botOk = validateSlackToken('edit-slack-bot', 'xoxb-', 'edit-slack-bot-error');
    const appOk = validateSlackToken('edit-slack-app', 'xapp-', 'edit-slack-app-error');
    if (!botOk || !appOk) return;
    const bot = document.getElementById('edit-slack-bot').value.trim();
    const app = document.getElementById('edit-slack-app').value.trim();
    setBtnLoading('btn-save-slack', 'saving…');
    try {
      await putConfig('slack.botToken', bot);
      await putConfig('slack.appToken', app);
      setBtnSuccess('btn-save-slack', '✓ saved');
      showToast('Slack tokens updated', 'ok');
    } catch (e) {
      setBtnError('btn-save-slack', 'failed');
      showToast('Could not save: ' + e.message, 'err');
    }
  }

  /* ── Console: edit agent config ─────────────────────────────────────── */
  async function saveAgentEdit() {
    const modelOk = validateRequired('edit-model-id', 'edit-model-error', 'Model ID is required');
    const adminOk = validateRequired('edit-admin-id', 'edit-admin-error', 'User ID is required');
    if (!modelOk || !adminOk) return;
    const model = document.getElementById('edit-model-id').value.trim();
    const admin = document.getElementById('edit-admin-id').value.trim();
    setBtnLoading('btn-save-agent', 'saving…');
    try {
      await putConfig('bedrock.modelId', model);
      await putConfig('slack.adminUserId', admin);
      setBtnSuccess('btn-save-agent', '✓ saved');
      showToast('Agent config updated', 'ok');
    } catch (e) {
      setBtnError('btn-save-agent', 'failed');
      showToast('Could not save: ' + e.message, 'err');
    }
  }

  /* ── HTML escape ────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Auth / session ─────────────────────────────────────────────────── */
  async function loadSession() {
    try {
      const res = await fetch('/api/auth/get-session', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const email = data?.user?.email;
      if (email) {
        const userEl = document.getElementById('header-user');
        const emailEl = document.getElementById('header-user-email');
        if (userEl) userEl.style.display = 'flex';
        if (emailEl) emailEl.textContent = email;
      }
    } catch { /* session endpoint unavailable — auth may be disabled */ }
  }

  async function signOut() {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    window.location.href = '/api/auth/sign-in/social?provider=google&callbackURL=/';
  }

  /* ── Init ───────────────────────────────────────────────────────────── */
  async function initConsole() {
    loadHealth();
    loadCapabilities();
    loadSession();
  }

  async function init() {
    try {
      const entries = await getConfig();
      const cfg = Object.fromEntries(entries.map(e => [e.key, e.value]));

      const hasSlack = cfg['slack.botToken'] && cfg['slack.appToken'];
      const hasBasics = cfg['bedrock.modelId'] && cfg['slack.adminUserId'];

      if (!hasSlack) {
        showScreen('screen-welcome');
      } else if (!hasBasics) {
        // Pre-show the success banner since Slack is already connected
        const banner = document.getElementById('slack-connected-banner');
        if (banner) banner.classList.add('visible');
        showScreen('screen-basics');
      } else {
        // Pre-populate edit fields with current values
        const modelEl = document.getElementById('edit-model-id');
        const adminEl = document.getElementById('edit-admin-id');
        if (modelEl) modelEl.value = cfg['bedrock.modelId'] || '';
        if (adminEl) adminEl.value = cfg['slack.adminUserId'] || '';
        initConsole();
        showScreen('screen-console');
      }
    } catch {
      // If we can't reach the API, show welcome screen
      showScreen('screen-welcome');
    }
  }

  init();
  </script>
</body>
</html>`;
}
