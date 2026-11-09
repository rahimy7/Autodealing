# OmniAI — Plataforma Omnicanal con IA

Full-stack omnichannel customer communication platform built by RVR Service. Manages WhatsApp/Instagram/Facebook conversations, AI chatbot flows, marketing campaigns, contacts, agents, and analytics — all in one unified dashboard.

It is a **product with one code base and one instance per client**: brand, modules
and business identity come from `lib/platform-config/src/clients/<id>.ts`, chosen
at boot with `CLIENT_ID`. Read **`PLATFORM.md`** before adding a client, deciding
where a change belongs, or deploying — no branch or copy per client.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/omnicanal run dev` — run the frontend (port 5173)
- `pnpm --filter @workspace/mobile run start` — run the Expo mobile app (see `artifacts/mobile/README.md`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm clients:list` / `clients:show <id>` / `clients:env <id>` / `clients:new <id>` — client instances
- Required env: `DATABASE_URL` — Postgres connection string
- Per-instance env: `CLIENT_ID` — which client this deployment is (defaults to `nicadom`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter routing + TanStack Query + shadcn/ui + Recharts + react-icons
- Mobile: Expo SDK 54 libraries + expo-router + TanStack Query, built locally (no EAS). Push goes straight to FCM and APNs from our own server — no Expo cloud service is involved
- API: Express 5 (port 8080, path prefix `/api`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle for API server)

## Where things live

- `artifacts/mobile/` — Expo (React Native) app for admins and agents, with push notifications. Routes in `app/`, shared code in `src/`
- `artifacts/omnicanal/src/pages/` — all 7 page components (dashboard, inbox, contacts, campaigns, chatbot, agents, settings)
- `artifacts/omnicanal/src/components/layout/` — Sidebar and Layout components
- `artifacts/omnicanal/src/index.css` — dark navy/teal theme variables
- `artifacts/api-server/src/routes/` — 7 route files (health, contacts, agents, conversations, campaigns, chatbot, analytics)
- `lib/api-spec/openapi.yaml` — OpenAPI 3.1 spec (source of truth for all API contracts)
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks (do not edit manually)
- `lib/api-zod/src/generated/` — generated Zod schemas for server-side validation
- `lib/db/src/schema/` — Drizzle ORM table definitions (contacts, agents, conversations, messages, campaigns, bot_flows)
- `lib/platform-config/src/clients/` — one file per client instance (brand, modules, business identity)
- `lib/extensions/` — what only one client needs, kept out of the core (see its README)
- `PLATFORM.md` — the one-core/many-instances model: adding a client, git flow, releases

## Architecture decisions

- Contract-first: all API contracts defined in OpenAPI, then codegen produces hooks + Zod schemas. Server validates with Zod, client uses generated hooks.
- One core, one instance per client (`PLATFORM.md`). Brand and modules resolve at runtime — the server from `CLIENT_ID`, the frontend from `GET /api/config` — so a single build and a single image serve every client. A disabled module does not mount its router and disappears from the menu; it is not a hidden button.
- Path-based proxy routing: API at `/api/*`, frontend at `/`. Global reverse proxy routes by path.
- All analytics are computed in-memory from DB data (no materialized views needed at this scale).
- Frontend port changed from 18599 to 5173 (standard Vite port) — required for workflow system detection.
- Drizzle enum fields (e.g. `contactTagEnum`, `channelEnum`) require explicit casting when inserting from Zod-parsed strings.
- The mobile app reuses the generated React Query hooks directly (`@workspace/api-client-react` is runtime-agnostic and already React Native aware), so there is no second API client to keep in sync.
- Push notifications are decided server-side, never by the device: `lib/push.ts` resolves the audience from who owns the conversation, so the same rule holds no matter which client triggered the change. It then fans out per platform — `push-fcm.ts` (Android) and `push-apns.ts` (iOS) — both talking to the OS gateway directly, with no third-party relay to depend on or pay for.
- Desk alerts are client-side, off the conversation poll the inboxes already run (`lib/notifications.ts`): the platform has no realtime channel, and a diff between two polls says exactly what changed. A handoff — a chat that just appeared on the user's plate — gets its own chime and a ribbon (`lib/handoffs.ts` + `HandoffRibbon`) that persists across screens and reloads until it is opened or dismissed; a plain inbound message gets the shorter chime and a transient banner. A closed browser is the mobile app's job.
- Gmail is a channel like the Feed, not like the chat inbox (`lib/email.ts`): mail is grouped by Gmail thread, the AI classifies it and leaves a draft, and a person approves it (or it goes out alone when the intent label is safe and "enviar sin revisión" is on). There is no webhook — Gmail only pushes through Pub/Sub, which would need a topic in each client's Google Cloud — so the scheduler reads the mailbox history every minute. The connection is the official Gmail API over OAuth: the admin pastes the Client ID/Secret and presses "Conectar con Google"; the `state` of that redirect is signed with the session secret (`signPayload`) because the callback cannot carry the panel session. Only the primary inbox opens threads: promotions, social, updates, forums and automated senders stay out. `lib/email-format.ts` holds the pure parts (MIME in and out, quoted-text stripping) and is what the tests cover.
- One person, one contact, whatever the channel (`lib/contact-identity.ts`). The email address is the key mail arrives by: whoever holds it in `contacts.email` gets the emails, so a customer who states their email in a WhatsApp chat pulls in the contact that was born from their mail. The phone links the other way: a new WhatsApp number binds to an existing contact with no channel yet and that phone. Anything weaker (a phone in an email signature, the same name) is only a suggestion — "Vincular contacto" in the Correo view and "Unir contacto" in the contact card merge two contacts in one transaction, because merging two different customers is far worse than leaving two cards.
- Email attachments are staged before the message they belong to exists (`email_staged_attachments`): a file uploads the moment it's picked (`POST /email/attachments`, outside the OpenAPI contract like the chat/media uploads), and a reply, an approved draft, or a brand-new composed email just references its id. The bytes get pulled from storage into the outgoing MIME (`buildMimeMessage`'s `multipart/mixed`, RFC 2231 for non-ASCII filenames) and the staged row is discarded only once Gmail actually accepts the send — a failed send keeps the upload so retrying doesn't mean re-attaching. An hourly scheduler sweep (`purgeOldStagedEmailAttachments`) catches whatever a closed composer left behind after 24h. `composeNewEmail` is the one path that opens a thread from our side instead of the customer's: Gmail only hands out a thread id after the send, so the local row is created after, not before.
- The mobile app mirrors the web Correo screens (`app/email/`) with the same shape: a list, a thread with a draft-or-compose bar, "Vincular contacto", and its own attachment staging (`src/lib/email-media.ts`, `src/components/EmailAttachments.tsx`) built on the same upload-on-pick idea. Opening an inbound attachment has no signed link to hand the OS viewer (unlike chat media, it isn't in our storage — it's read from Gmail on demand), so it downloads through `expo-file-system` with the auth header and hands off to `expo-sharing`'s share sheet instead.
- Agent connectivity comes from the session, never from the `agents.status` column: `lib/presence.ts` remembers who called recently (every authenticated request refreshes it) and the column only carries the availability the agent chose (online/busy).
- Handing a chat to a person is a question of *where*, not only of *what*: the human team is split by store, so before a handoff the customer is placed on the map. `lib/branches.ts` is the zone dictionary (which sectors belong to each branch) and each branch carries a **locality label**; the active workflow says which group that label goes to, so "which store's people get this customer" is edited in the panel like any other routing rule (`scripts/setup-locality-routing.ts` wires it, the branch group name in code is only the fallback). Locality labels are deliberately excluded from the AI intent classifier — where the customer is and what they want are different questions, kept in different columns (`conversations.labelId` vs `localityLabelId`).
- A handoff never lands on a generic "human team" group: it always resolves to a store. The customer's branch comes from their zone, from the branch they pick off the list, or — after asking `MAX_ZONE_ASKS` times without an answer we can place — from the default branch (the capital's, biggest coverage). A group with nobody in it is a chat waiting for no one, which is why the escalation target of every virtual agent is a store group too. Only the real branch is recorded as the conversation's locality; the fallback is not, because it is our decision and not something we know about the customer.

## Product

**OmniAI** is a full omnichannel communication platform:
- **Unified Inbox** — All WhatsApp/Instagram/Facebook conversations in one place with real-time filtering by channel, status, and label. Split-pane view with message thread.
- **Contacts** — CRM-style contact database with search, tag filtering (Lead/VIP/In Process/Support), channel indicators.
- **Campaigns** — Send WhatsApp/Instagram/Facebook marketing campaigns. Track open rates, recipients, send dates.
- **Chatbot IA** — Configure keyword-triggered conversation flows with multi-channel support and agent handoff.
- **Agents** — Manage your team: status (online/busy/offline), active chats, channel assignments.
- **Dashboard** — KPI overview (conversations, resolution rate, response time, bot handling), daily volume chart, channel breakdown, agent performance table.
- **Settings** — Plan details ($300/mo), API connection status for all 3 channels, usage meters, Meta certification info.

## User preferences

- Language: Spanish throughout the UI
- The customer never sees the internal org chart: a virtual agent does not say which area it belongs to ("soy de ventas"), does not name other agents, and does not offer to transfer. It just answers, and the system moves the chat in silence. Enforced in `BASE_CONDUCT`/`SCOPE_CONDUCT` (`lib/openai-client.ts`) and by `speakingName()`, which drops the job title from the agent's name before the model sees it — the panel still shows "Nico Ejecutivo de ventas", the customer only ever hears "Nico".
- Theme: Dark navy (#0a0f1e) with electric teal (#00d4e8) accent
- Currency/pricing context: Dominican Republic (ITBIS, USD pricing)
- Company: DECOLOR (client), RVR Service (service provider, www.rvrservice.com)

## Gotchas

- Frontend must run on port 5173 (or another supported port) — the workflow system only detects supported ports. Avoid assigning ports outside: 3000, 3001, 3002, 3003, 4200, 5000, 5173, 6000, 6800, 8000, 8008, 8080, 8099, 9000.
- Always run `pnpm run typecheck:libs` before running API server typecheck — the DB and api-zod packages are composite libs that must be built first.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`.
- The `useListMessages` hook requires `selectedId!` (non-null assertion) + `{ query: { enabled: !!selectedId } }` to conditionally fetch.
- wouter's `<Link>` renders as `<a>` — do NOT wrap it in another `<a>` tag.
- Mobile: `metro.config.js` must keep `disableHierarchicalLookup: false` — pnpm nests each package's dependencies, and Metro only finds them by walking up from the importing file.
- Mobile: native peer dependencies (`expo-font`, `expo-asset`, `@expo/metro-runtime`) have to be declared in `artifacts/mobile/package.json`; pnpm's strict layout does not expose them transitively. `npx expo-doctor` catches this.
- Mobile: push needs a real device and a native build (`npx expo prebuild` then `expo run:android` / `run:ios`); Expo Go cannot deliver remote push. Android additionally needs `google-services.json` present at build time, or `getDevicePushTokenAsync` throws.
- Gmail: while the Google Cloud OAuth app is in "Testing", Google revokes the refresh token after 7 days and the sync starts failing with `invalid_grant`. External apps must be published (the "unverified app" warning is expected); Workspace accounts can use an Internal app instead. The redirect URI to register is `<panel origin>/api/gmail/oauth/callback`.
- Mobile: APNs tokens from a debug build come from Apple's sandbox gateway — set `APNS_PRODUCTION=false` while testing or every send returns BadDeviceToken.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Store routing is set up with two scripts, in this order: `scripts/create-store-groups.ts` (a group per store, with its people) then `scripts/setup-locality-routing.ts` (a locality label per store + the label→group lines in the active flow). Both are idempotent; the second also creates `labels.kind` and `conversations.locality_label_id` with plain ALTERs, because `drizzle-kit push` on this database also wants to drop unrelated columns.
