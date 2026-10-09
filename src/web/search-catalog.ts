export type Guide = { id: string; title: string; group: string; description: string; sections: { title: string; body: string; code?: string }[] };
export const guides: Guide[] = [
  { id: "start", title: "Your first contribution", group: "Get started", description: "Give a change its own purpose, workspace and review.", sections: [
    { title: "Open a repository", body: "Sign in and create a repository, or open one where you are a member. Basic private repositories are available on the free plan. An owner can also import a public HTTPS Git repository; an import remains pending until its stored job is ready." },
    { title: "Create a change", body: "In Changes, describe the outcome you want. FlareGit records the purpose and accepted base, and creates an isolated Artifacts fork. Use the workspace with your own tools, or explicitly start the built-in agent. A listed provider name alone does not mean that provider is connected." },
    { title: "Checkpoint and review", body: "Push your work and mark the change ready. Integrate ready contributions to combine them into a preview. Checks, repairs, conversations and the exact combined preview commit remain available for a human decision. Acceptance moves shared history only after the repository ref update succeeds." },
  ] },
  { id: "cli", title: "CLI setup", group: "Get started", description: "Use ordinary Git and the FlareGit command line from your own workspace.", sections: [
    { title: "Build the CLI", body: "Install Bun and Git, then run these commands from the public source checkout. The compiled CLI is written to dist-cli/flaregit.", code: "git clone https://github.com/Joe-Simo/flaregit.git\ncd flaregit\nbun install\nbun run build:cli\n./dist-cli/flaregit --help" },
    { title: "Authenticate", body: "Create an API token in Account → API tokens. Supply it through the FLAREGIT_TOKEN environment variable using your secret manager. Keep tokens out of shell history, source code, screenshots and agent prompts. Use a repository-scoped token with the minimum permissions and an expiry." },
    { title: "Create a workspace", body: "Replace the repository ID and purpose below with your own. The command creates a change and workspace; it does not accept that change into shared history.", code: 'bun cli/flaregit.ts work <repository-id> "Describe your change"' },
  ] },
  { id: "agents", title: "Bring your own tools", group: "Collaborate", description: "Independent workspaces for your editor, coding agent and external services.", sections: [
    { title: "Work through Git", body: "Create a FlareGit change workspace and use its Git remote with your preferred editor or coding agent. Each contribution stays isolated. Share the task purpose and permitted scope; keep credentials outside agent context." },
    { title: "Connect checks and automated reviews", body: "Repository owners register an external service in Settings → Connections. The owner issues a signing secret once and assigns checks to the service. Store that secret on the service backend. Connections are vendor-neutral; compatibility with a named provider must be verified separately." },
    { title: "Report an exact result", body: "The report CLI signs the exact report bytes using FLAREGIT_CONNECTION_SECRET from the service environment. Reports bind the combined preview, commit, tree, policy and registered check run. Retry unchanged bytes with the same event ID; use a new event ID for a new status. Automated reviews cannot approve or merge.", code: "bun cli/flaregit.ts report <repository-id> --service <connection-id> --file <report.json> --event <stable-event-id>" },
  ] },
  { id: "review", title: "Review and acceptance", group: "Collaborate", description: "Decide what becomes shared history, with the original work intact.", sections: [
    { title: "Review the combined preview", body: "An integration combines one to eight ready contributions against the accepted head. Inspect the combined diff, checks and all repair rounds. Add review conversations and line comments. A green check only covers its stated scope; it does not replace human review." },
    { title: "Choose the history strategy", body: "Merge preserves the combined graph. Squash produces a single accepted change while preserving original contributor forks for review and recovery. Review the exact combined preview commit before merging; acceptance does not authorize a different rebuilt commit." },
    { title: "When the base moves", body: "If accepted history changes before publication, the compare-and-swap push refuses the stale combined preview. Re-run integration against the new head and review the resulting combined preview. Overlapping changes and consequential repairs remain visible." },
  ] },
  { id: "recovery", title: "Interruptions and recovery", group: "Collaborate", description: "Understand saved work, failed runs and the next safe action.", sections: [
    { title: "Read the run state", body: "The recovery panel distinguishes a saved proposal, a pushed Git commit and a recorded checkpoint. These states are different. A failed run retains its frozen purpose, context, scope and saved proposal when available." },
    { title: "Resume deliberately", body: "Open the recovery panel and use Resume saved proposal when offered. FlareGit revalidates current permissions, purpose and scope. Resuming uses the saved proposal rather than silently asking a model to invent a replacement. A newer remote branch prevents a stale push." },
    { title: "Recover publication", body: "Combined preview commits are retained under private repository refs. A publication record tracks preparation and completion. Recovery can fetch that exact stored commit after the original container is gone. An external integration failure does not revert an accepted landing." },
  ] },
  { id: "webhooks", title: "Webhooks and delivery", group: "Integrate", description: "Visible delivery attempts, retries and deliberate replay.", sections: [
    { title: "Register a destination", body: "Repository owners configure HTTPS webhook destinations in Settings. Keep receiver secrets server-side. Verify the Standard Webhooks signature over the raw request bytes before processing an event." },
    { title: "Handle duplicates", body: "Use webhook-id as the stable event identity. webhook-sequence identifies repository ordering. Delivery is retried with backoff, and maintainers can replay failed deliveries. Consumers must deduplicate an event safely; a retry is not a new repository change." },
    { title: "Inspect failures", body: "Delivery status and attempts are visible in Settings. Publication events are recorded only after durable repository integration. Browsing and review remain available when a webhook destination is unavailable." },
  ] },
  { id: "migration", title: "Imports and mirroring", group: "Integrate", description: "Move incrementally while keeping FlareGit independent of GitHub availability.", sections: [
    { title: "Import a public repository", body: "Create a repository from a public HTTPS Git URL. Import requests are durable jobs. If the provider is slow or unavailable, inspect or resume the same pending job rather than creating another repository. Readiness confirms the imported head; preservation of every historical ref is not yet a verified product guarantee." },
    { title: "Use your existing CI", body: "Imported repositories use native Git integrity checks plus maintainer-required external checks. FlareGit does not install or execute arbitrary imported application code as a substitute for those checks. Register your CI service and report results for the exact combined preview." },
    { title: "Mirror accepted changes", body: "Configure optional one-way GitHub mirroring in Settings. Mirroring runs after acceptance and never force-pushes. Failure stays visible without reverting the accepted FlareGit commit. Importing once does not enable continuous inbound synchronization." },
  ] },
  { id: "security", title: "Access and security", group: "Operate", description: "Private by default, explicit sharing and narrow credentials.", sections: [
    { title: "Repository isolation", body: "Private repositories require membership. Owners manage members and integration settings. Read and write API tokens can be scoped to one repository and expire. Never put server credentials in browser bundles, logs, public comments or agent context." },
    { title: "Publish deliberately", body: "An owner must explicitly confirm public visibility. Public browsing exposes accepted source and history; private task context and combined preview refs remain private. Enabling public community spaces publishes only new explicitly public records, not existing private conversations." },
    { title: "Report abuse or impersonation", body: "Signed-in users can submit an abuse report from the application footer. Reports enter a human operator queue. A written resolution is required when a report is closed. Public status includes the open-report count and age; this is not a claim that every report has already been reviewed." },
  ] },
  { id: "self-host", title: "Self-host on Cloudflare", group: "Operate", description: "Deploy the open-source project under your own account.", sections: [
    { title: "Requirements", body: "You need Bun, Git, Docker, a Workers Paid account with Containers, Durable Objects, Workflows and Queues, Artifacts access, and a Clerk application. Configure your application domain and a separate preview Worker origin for each repository. Consult the repository README for the exact bindings and secrets before deployment." },
    { title: "Build and check", body: "Run from the repository root. Tests use real local Git and isolated emulator fixtures; passing them does not prove hosted throughput or customer behavior.", code: "bun install\nbun run lint\nbun run typecheck\nbun test\nbun run build" },
    { title: "Configure before deploying", body: "Set your own account bindings, authorized Clerk origins and required secrets in wrangler.jsonc and Wrangler. Keep billing credentials optional. Once configured, build and deploy using the supported toolchain.", code: "bun run build\nbunx wrangler deploy" },
  ] },
];

export interface SearchResult { id: string; title: string; description: string; group: string; href: string; searchText?: string }
export const publicSearchCatalog: SearchResult[] = [
  ...guides.map(guide => ({ id: `guide-${guide.id}`, title: guide.title, description: guide.description, group: "Documentation", href: `/docs#${guide.id}`, searchText: guide.sections.map(section => `${section.title} ${section.body} ${section.code ?? ""}`).join(" ") })),
  { id: "pricing", title: "Pricing", description: "Free private repositories, plan limits and available billing.", group: "FlareGit", href: "/pricing" },
  { id: "about", title: "About FlareGit", description: "The purpose and principles behind the project.", group: "FlareGit", href: "/about" },
  { id: "status", title: "System status", description: "Workflow health, measured scope and operational accountability.", group: "FlareGit", href: "/status" },
];
