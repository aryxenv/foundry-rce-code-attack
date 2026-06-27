# LLM Prompt Injection RCE Demo

Educational demo of an unexpected code-execution attack against an LLM agent.

The scenario: a market-research agent is supposed to query only sanitized Contoso data, then make charts. A prompt injection can steer the charting step into running code that reaches back into the agent container, bypasses the sanitized data path, and leaks fake PII through a generated image.

No real data is used.

https://github.com/user-attachments/assets/26f7a881-cd77-4fd3-b0db-aaacb4bcb401

## Secure vs. unsecure

| Variant    | What runs code                                                                 | Result                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsecure` | Custom `execute_code` tool inside the same hosted agent container (in-process) | Generated Python can see container environment like `DATABASE_URL`, query PostgreSQL directly, bypass sanitized views, and hide fake PII in chart labels.                   |
| `secure`   | Microsoft Foundry Code Interpreter                                             | Generated Python runs in Foundry's managed sandbox, not in the agent container (Dynamic ACA). It gets sanitized data only and cannot access the container's DB credentials. |

The point is not that "LLMs are bad." The point is that your architecture may create vulnerabilities which make an unexpected RCE/Code Attack possible: if the model can be tricked into writing code, that code must not run next to secrets, databases, or privileged identities.

### Unsecure Architecture

![Unsecure Architecture](./unsecure/unsecure_architecture.png)

### Secure Architecture

![Secure Architecture](./secure/safe_architecture.png)

## Getting Started

Prerequisites:

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`)
- [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) (`azd`)
- Access to Microsoft Foundry

Deploy the whole demo with a single command. One root `azd up` provisions a
single resource group and wires everything together: the web slide deck, the
API, a shared PostgreSQL database (seeded with fake demo data), a Microsoft Foundry
project, chart storage, an Azure Container Registry, and both hosted agents
(`unsecure` and `secure`).

```pwsh
az login
azd auth login
azd up
```

When it finishes, `azd` prints the deployed endpoints. Open the **web**
Container App URL to launch the presentation. You can re-print it any time:

```pwsh
npm run azure:url
# or: azd env get-value AZURE_WEB_CONTAINER_APP_HOSTNAME
```

### Running the demo

The frontend is a self-contained slide deck, so it's guide-ready out of the box.
Walk through the slides for the full story, then run the three live demos
embedded in the deck:

1. **Trusted analyst** - a normal chart request against the unsecure agent.
2. **Recon to breach** - a step-by-step prompt-injection attack that exfiltrates
   fake PII through a generated chart image.
3. **Secure boundary** - the same attack against the secure agent, which isolates
   code execution in Foundry Code Interpreter.

Press **Space** on a demo slide to send each step's prompt; the goal/outcome
cards on the left explain what to watch for. Prefer to drive the hosted agents
directly in the Foundry portal? The exact prompts live in
[`trial_prompts.md`](./trial_prompts.md).

## Cleanup

Run from the repository root:

```pwsh
azd down --purge
```

## Collaborators

- Aryan Shah - Solutions Engineer (Cloud & AI)
- Remy van den Spiegel - Solutions Engineer (Security)
- Narjiss Youyou - Cloud Solutions Architect (Cloud & AI)
- Romiya Nepali - Cloud Solutions Architect (AI Business)

## License

MIT

## Disclaimer

> [!IMPORTANT]
> The owner of this project assumes no liability for any use, misuse, or damages arising from this repository.
