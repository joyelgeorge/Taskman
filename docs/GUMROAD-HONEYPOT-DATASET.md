# Gumroad Product Listing: AI Agent Prompt-Injection & Honeypot Evaluation Benchmark

*Digital Product Packaging for Taskman Issue #206 (`★2`)*

---

## 1. Product Overview
- **Product Title**: The AI Agent Security Benchmark: 232 Real-World Prompt Injection & Trap Attack Vectors
- **Price**: **$49 USD** (Free 20-sample pack available)
- **Format**: JSON / CSV dataset + Node.js / Python validator suite + technical methodology whitepaper.
- **Target Audience**: AI agent engineers, LLM app developers, and security teams building autonomous tool-calling systems.

---

## 2. What Is Included in the Pack

### The Dataset (`data/honeypot-eval-232.json`)
232 curated, categorized attack payloads targeting autonomous agents:
1. **Instruction Override / Jailbreak Vectors**: Direct attempts to bypass system prompts (`"IGNORE ALL PREVIOUS INSTRUCTIONS..."`).
2. **Hidden Exfiltration Payloads**: Indirect prompt injection concealed in markdown images, zero-width spaces, and HTML comments.
3. **Tool/Function Abuse Traps**: Payloads designed to trick model tool calls into executing destructive shell commands, unauthorized database queries, or arbitrary file reads.
4. **Economic Traps & Fake Bounties**: Malicious task descriptions requesting upfront fees, seed phrase reveals, or unpaid work.

### The Detector Code (`detectors/injection-guard.mjs`)
- Pure Node.js / Python regex & heuristic gate for sub-millisecond pre-flight checks before passing untrusted text to LLM context windows.

---

## 3. Gumroad Copy & Listing Text

### Headline:
> **Stop prompt injection before your agent executes destructive tools.**

### Description:
Building agents that browse the web, read emails, or process user documents? Your agent is exposed to indirect prompt injection.

This benchmark gives your engineering team 232 real-world attack vectors observed in production autonomous agent systems, complete with an automated evaluation test harness.

**What You Get:**
- `benchmark.json`: 232 labeled test cases with category, attack vector, and expected defense response.
- `eval-runner.js`: Automated script to benchmark your LLM system prompt / guardrail accuracy.
- `guardrail.js`: Production-ready regex and heuristic filter.
- Free lifetime updates as new attack vectors are indexed.
