# Write-up: Author Support & Communication Portal

**What I prioritised.** The brief weights AI quality and architecture highest, and says to favour the core ticket flow over extras. So I built the loop end to end first: an author raises a ticket → it's triaged → an admin gets a grounded draft → the author sees the reply live. Then I hardened that loop rather than adding features. Three ideas shaped it:

1. **The AI should never be in the critical path.** Tickets are saved before any model call, and triage runs asynchronously. If the model is down, slow, rate-limited or unconfigured, keyword rules triage the ticket (labelled "Rules" so the team knows to check), a circuit breaker stops the app from hammering a failing provider, and the draft panel tells the admin to write manually. Ops keeps working through an outage.
2. **Ground the model in facts it can't get wrong.** Support replies at BookLeaf are full of numbers and dates: pending royalty, the next payout date, the ₹1,000 threshold, production stage. I compute these in code and give them to the model as plain statements, alongside only the knowledge-base section for the ticket's category and BookLeaf's own examples of good answers. The draft also returns the actions it commits the team to ("trigger an Amazon re-sync") as a checklist, so an edited reply can't promise something nobody does.
3. **Measure it.** Every AI call is logged with tokens and latency, and the admin side shows spend alongside quality proxies: how often admins override triage, and how often drafts go out unedited. That's how you'd know whether a prompt or model change helped.

**Trade-offs I made.**
- *DeepSeek Flash over V4-Pro.* I ran the same tickets through both. Triage was identical, and Flash's drafts followed BookLeaf's tone rules more consistently at about a third of the cost and latency. The policy and facts are supplied, so the task rewards instruction-following, not raw reasoning power. Drafting can be moved to V4-Pro with one environment variable if quality ever slips. Triage also runs with thinking turned off, since it's a rubric lookup.
- *Category routing over vector search.* The knowledge base is six sections, so routing by the triaged category is cheaper, deterministic and easy to debug. Retrieval earns its complexity once the knowledge base is much larger.
- *Lazy, cached drafts over pre-generating for every ticket.* Tokens are only spent on tickets someone opens, and a draft is reused until the conversation changes.
- *Simple infrastructure.* One deployable, in-process SSE and in-process background triage, plus embedded Postgres for zero-setup local runs. This is right for a demo and a small team; it's the first thing to change at scale (below).
- *Functional UI over polish*, as the brief asked. The time went into queue ergonomics instead: urgency ordering, SLA flags, "awaiting reply" markers, URL-shareable filters, one-click "assign to me".

**Evolving this into production.**
- **Reliability:** a durable job queue for triage, Postgres LISTEN/NOTIFY or Redis for realtime across instances, and attachments on S3 with scanning.
- **Channels:** email/WhatsApp notifications and inbound email replies threaded into tickets, since that's where authors actually are.
- **AI quality loop:** build an eval set from historical tickets with human-labelled categories and model replies; gate prompt and model changes on it; feed admin edits to drafts back in as new calibration examples.
- **Deeper grounding:** connect drafts to live systems (the royalty ledger with per-platform breakdowns, production tracker, distribution sync status) through tool calls, so the AI can answer "where's my payout?" with the actual transaction rather than policy.
- **Automation with guardrails:** let high-confidence, low-risk categories (e.g. "how do I update my bio") auto-send after a short human-veto window. Measure deflection and CSAT before expanding it.
- **Migration:** BookLeaf currently runs on Bubble. This API could sit beside it first (Bubble calling the triage and draft endpoints through its API connector), then take over screens one by one.
