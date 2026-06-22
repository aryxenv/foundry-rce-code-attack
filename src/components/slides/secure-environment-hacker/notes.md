# Presenter notes — Demo 3 · Secure boundary (same attacker)

**Time:** ~30s · **Steps:** 4 (Space advances each) · **Agent:** Secure

Re-run the critical checkpoints from Demo 2. Same prompts — the outcome changes
because the runtime context changed.

## Say (one line per Space press)

> "Same attacker, same prompts — secure agent."
> 1. _(Space)_ "Tool discovery — capabilities are narrower."
> 2. _(Space)_ "Environment recon — no `DATABASE_URL`, no `AZURE_*` secrets."
> 3. _(Space)_ "Database connectivity — the connection just fails."
> 4. _(Space)_ "The full audit payload — the chart still renders from sanitized
>    rows. There's nothing private to leak."

## Do / cues

- Explicitly contrast each outcome with Demo 2 ("last time this leaked…").
- Land the point: _the process is identical; the context is gone._
