# All Things Agentic Hackathon

This file is the project’s working digest of the All Things Agentic hackathon requirements. It intentionally omits prize amounts, credit offers, and unrelated promotional material. The official Devpost rules are binding if this summary and the current rules differ.

Source: [All Things Agentic Hackathon — Official Rules](https://allthingsagentichackathon.devpost.com/rules). Checked 2026-08-19.

## Contest snapshot

- Contest: All Things Agentic Hackathon, sponsored by Google and administered by Devpost.
- Contest period: August 3, 2026 at 9:00 AM Pacific Time through August 31, 2026 at 5:00 PM Pacific Time.
- Submission deadline: August 31, 2026 at 5:00 PM Pacific Time.
- Judging: September 1 through October 1, 2026 Pacific Time.
- Winner announcements: on or around October 8, 2026.
- The project must be an autonomous agent that goes beyond a standard chat loop. It may run in the background, complete a complex workflow, or transform and coordinate data asynchronously.

## Eligibility and participation

Participants must be above the age of majority in their jurisdiction, have internet access during the contest period, and not be subject to the listed country, territory, export-control, sanctions, government-conflict, sponsor, administrator, or household restrictions in the official rules.

An entry may be submitted by one person, a team, or an organization. Every team member must be eligible and added to the Devpost project. A representative must be authorized to submit for a team or organization. If entering on behalf of an employer, the entrant must have the employer’s knowledge and authorization.

## What must be built

Every project must:

1. Use Gemini 3.5 or newer through the Gemini API or Vertex AI.
2. Use at least one Google agent framework: Google ADK, GenAI SDK, Antigravity SDK, or Genkit.
3. Use at least one Google Cloud infrastructure service, such as Cloud Run, Cloud SQL, Firestore, GKE, or Pub/Sub.
4. Be built and deployed as a working agent, not only described as a concept.
5. Demonstrate behavior beyond a simple request-response chatbot, such as autonomous background execution, a multi-step workflow, useful data mutation/transformation, or agent delegation.

The project must fit one of the following categories.

### Taskmaster

Build a complete workflow that takes action on a messy, multi-step task. The agent should handle details, communicate with the right destinations, and prove it reduces friction rather than only generating text.

### Collaborative Partner

Build an agent that leads a user through a process, asks clarifying questions, captures feedback, takes notes, and adapts to the user’s way of working. It should actively synthesize or transform information, not only retrieve it.

### Fortified Enterprise Fleet

Build a scalable network of institutional agents connected to enterprise infrastructure. The project should show how agents are discovered and managed, how they retain context during asynchronous work, and how they access production-like data while respecting compliance, data sovereignty, and security policies.

The expected capability areas for this category are:

- Discovery and lifecycle: an Agent Registry for publishing, versioning, and discovering approved agents.
- Execution and state: an Agent Runtime for long-running asynchronous work and a Memory Bank for persistent, secure context.
- Security and governance: Agent Identity, an Agent Gateway for routing and policy enforcement, and Model Armor or equivalent controls against prompt injection, tool poisoning, and PII leaks.
- Telemetry: OpenTelemetry-compatible audit logs and end-to-end agent execution traces.

Encois is currently shaped for Fortified Enterprise Fleet. The MVP should implement a credible thin slice of these capabilities instead of claiming that all enterprise requirements are complete.

## Project and implementation rules

- The project must run consistently on its intended platform and behave as shown in the submission.
- The project must be newly created during the submission period. Standard frameworks, libraries, templates, and AI coding assistants are allowed, but pre-existing code or work incorporated into the project must be disclosed.
- Third-party SDKs, APIs, data, and information may be used only with the required authorization and in compliance with their terms and licenses.
- The project must be made available free of charge for judging and testing through the end of the judging period when access is provided. If private, testing instructions must include working credentials.
- The application must support English. Submission materials must be in English or include English translations/subtitles as required by the official rules.
- The submission must be the entrant’s original work, solely owned by the entrant/team/organization, and must not violate another party’s intellectual-property, privacy, publicity, contract, or other rights.
- Open-source components are allowed when their licenses are followed and the project adds its own original work.
- A project cannot be developed with prohibited financial or preferential support from the sponsor or administrator, and conflicts of interest may disqualify an entry.

## Required submission materials

The Devpost submission must include:

- One selected category.
- A hosted project URL when available. A hosted, testable project is strongly encouraged.
- A project description covering features and functionality, technologies, other data sources, and findings/lessons learned.
- A public or private repository URL on GitHub, GitLab, or Bitbucket. If private, grant access to the addresses specified in the official rules.
- Reproducible spin-up instructions in `README.md` for local setup and/or cloud deployment, even if judges do not run the project.
- An architecture diagram showing how Gemini connects to the frontend, backend, databases, queues, integrations, and other important components.
- A public demonstration video on YouTube or Vimeo, no longer than four minutes. It must explain the problem and value, show the application working, and prove the backend runs on Google Cloud through suitable console, deployment, logs, or service evidence. The video must be in English or include English subtitles.

The video should show live, unedited evidence of action, such as an agent run, terminal logs, database changes, queue activity, or user-visible output.

## Judging criteria

### Innovation and operational utility — 40%

How much real-world friction does the agent remove autonomously? Judges favor high-value action and meaningful agent behavior over a simple chat interface.

Category-specific emphasis includes completing background workflows for Taskmaster, synthesizing or mutating complex data for Collaborative Partner, and intelligent delegation for Fortified Enterprise Fleet.

### Architectural discipline and technology stack — 30%

Judges evaluate modularity, separation of concerns, state and memory management, failure tolerance, efficient data/context handling, secure tool isolation, and reliable multi-agent routing.

### Demo and production readiness — 30%

Judges evaluate whether the video clearly proves the problem, action, architecture, and Google Cloud execution, and whether the repository provides a clean architecture diagram and reproducible setup.

## Optional bonus contributions

Optional contributions can improve the score:

- Publish a public article, podcast, or video about how the project was built and say that it was created for this hackathon.
- Publish a social post promoting the project. Posts on X or LinkedIn must include `#AllThingsAgenticHackathon`.
- Integrate additional Google AI models such as Gemma, Veo, or Lyria.

These are optional. They must not delay the required working demo, documentation, and deployment proof.

## Encois compliance map

| Requirement | Encois implementation target | Evidence to preserve |
| --- | --- | --- |
| Gemini 3.5+ | Gemini API or Vertex AI used for evidence synthesis and user questions | Model configuration, request traces without sensitive prompts, demo output |
| Google agent framework | Google ADK or another eligible framework for control-plane orchestration | Agent definitions, delegation flow, run logs |
| Google Cloud service | Prefer Cloud Run plus one durable store and one async mechanism | Cloud project/service/revision, logs, deployment instructions |
| Autonomous behavior | Scheduled or event-triggered investigation that gathers evidence and produces an insight | Trigger, job state, tool calls, evidence, final insight |
| Enterprise fleet | Registry-like agent metadata, scoped identity, durable run state, tool policies, traces | Registry records, authorization decisions, trace view |
| Evidence-backed UX | Each insight links claims to source records and observed timestamps | UI screenshots, normalized facts, source IDs |
| Reproducibility | Root README, `.env.example`, synthetic fixtures, local and cloud commands | Clean checkout run and demo checklist |

## Submission readiness checklist

- [ ] The selected category is recorded in the Devpost draft.
- [ ] Gemini 3.5 or newer is used through Gemini API or Vertex AI.
- [ ] An eligible Google agent framework is used in the agent path.
- [ ] At least one Google Cloud infrastructure service is deployed and visible in the demo evidence.
- [ ] The core flow performs autonomous or asynchronous work beyond chat.
- [ ] The UI and agent output show evidence, scope, timestamps, and limitations.
- [ ] The repository contains reproducible README instructions.
- [ ] The architecture diagram is complete and matches the deployed system.
- [ ] The demo video is public, in English or subtitled, and at most four minutes.
- [ ] Demo data is synthetic or authorized; secrets, tokens, and private identifiers are removed.
- [ ] Third-party licenses and data permissions are reviewed.
- [ ] The hosted URL and testing credentials, if applicable, work without payment or hidden manual setup.
- [ ] The final Devpost description lists technologies, data sources, features, and learnings.
