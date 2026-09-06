---
name: demand-scout
description: Discovers high-intent commercial demand, customer pain points, and willingness-to-pay signals across social media, forums, and developer communities.
metadata:
  version: 1.0.0
  author: taskman-engine
---

# Demand Scout: Customer Pain Point & Willingness-To-Pay Detector

This skill identifies active problems people are currently complaining about and paying to solve.

## Signal Sources
1. **Reddit**:
   - `r/SaaS`, `r/SideProject`, `r/smallbusiness`, `r/Entrepreneur`, `r/webdev`
   - Search phrases: "is there a tool that", "I'd pay for", "alternative to", "pricing is ridiculous", "manual process takes hours"
2. **X / Twitter**:
   - Builders lamenting missing tools, failed migrations, or broken APIs.
3. **Hacker News (Ask HN / Show HN)**:
   - "Ask HN: What manual repetitive task do you wish was automated?"
   - High-traction comments requesting features or custom exports.
4. **App Store & SaaS Negative Reviews**:
   - 1-star and 2-star reviews of popular SaaS products revealing recurring gaps and unmet features.

## Opportunity Extraction
For each detected signal:
- Quote the exact user complaint / expression of pain.
- Map out the simplest MVP solution that solves that specific pain.
- Suggest direct pricing model ($9/mo, $29 one-off, pay-as-you-go).
- Outline a 1-day outreach or distribution angle directly to the user who voiced the problem.
