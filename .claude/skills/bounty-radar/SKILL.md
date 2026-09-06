---
name: bounty-radar
description: Deep scanner across GitHub, Algora, Gitcoin, Immunefi, Hugging Face, and developer challenge boards to find all active bounties, grants, and paid work opportunities.
metadata:
  version: 1.0.0
  author: taskman-engine
---

# Bounty Radar: Ecosystem-Wide Paid Work Scanner

This skill monitors and catalogs developer bounties, challenges, and paid grants across all reachable venues.

## Monitored Ecosystems
1. **GitHub Issues with Bounties**:
   - Algora (`/bounty`, `bounty:`, `algora.io`)
   - Opire (`opire/bounty`)
   - Polar.sh (`polar.sh`)
   - Bountysource / IssueHunt
2. **Web3 / Protocol Bounties**:
   - Gitcoin Grants & Bounties
   - Immunefi & Code4rena (smart contract security / auditing)
3. **AI / Model Challenges**:
   - Hugging Face Community Competitions
   - Kaggle Prize Competitions
   - AI agent hackathons and open-ended RFPs
4. **Freelance & Micro-Contract Platforms**:
   - Upwork API / RSS feeds for specialized niche tasks (Node.js, PostgreSQL, AI automation)

## Discovery Mode
When scanning for bounties:
- Fetch recent issues labeled with `bounty`, `fund`, or sponsored keywords.
- Capture total reward value ($ or token equivalent).
- Categorize by domain (frontend, backend bugfix, documentation, optimization, security, scraper).
- Present opportunities sorted by reward amount and ease of completion without dismissing challenging problems.
