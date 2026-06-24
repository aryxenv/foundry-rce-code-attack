# Presenter notes — Demo 3 · Secure boundary (same attacker)

**Time:** ~30s · **Steps:** 4 (Space advances each) · **Agent:** Secure

Lead with the breach that worked on the unsecure agent, then replay the recon to
show _why_ it fails here.

## Say (one line per Space press)

> "Same attacker, same prompts — now the secure agent."
> 1. _(Space)_ "The full chart-exfiltration prompt that breached the last agent
>    — this time it just can't generate the chart."
> 2. _(Space)_ "So we replay the recon. Tool discovery — same tools, code
>    execution included. So why did it fail?"
> 3. _(Space)_ "Sandbox check — code still runs, but in an isolated Foundry
>    sandbox, not the agent container."
> 4. _(Space)_ "List the config keys, exactly like before — nothing. No
>    `DATABASE_URL`, no secrets. That's why the breach died at the first probe."

## Do / cues

- Open by reminding them this is the _same_ prompt that leaked PII a slide ago.
- Land the point: the sandbox is a dynamic, Foundry-managed container with no
  inherited environment, so the attacker's first real probe comes back empty.
