# OmniAI: App Store review

The review account is `review@omniai.example` with the public synthetic-only
password `OmniAI-Demo-2026!`. It does not authenticate against the production
user table. Never provide a customer's administrator credentials to App Review.

`createReviewDemo` runs before the real API router. It issues opaque, random
demo bearer tokens, each holding a separate in-memory copy of fictional data
for twelve hours. Demo tokens are not production session tokens. All requests
with a demo token are handled here; unsupported or expired requests are denied
and never continue into production routes. No database, media storage, push
provider, Meta channel or other outbound service is imported by this middleware.
Sending text in a demo chat changes only that session's memory. The demo does
not register push devices, upload files, purchase anything or send messages.
There are limits on sessions, contacts, messages and message length.

The account exposes Dashboard, Inbox, Contacts, Products, Agents and Monitor.
Other modules depend on organization permissions. Be explicit about the
available demo functionality and simulated channels in App Review notes.
Do not describe it as a connected Meta test organization or imply that
messages or notifications reach external recipients.

Verification: `pnpm --filter @workspace/api-server exec node --import tsx
--test tests/review-demo.test.ts`. These HTTP tests validate API response
contracts, independent session state, normal-login pass-through and denial
of sensitive or unknown routes for demo sessions.

Privacy policy and support: https://www.rvrservice.com/privacidad-apps

The mobile app exposes the policy before login and from both account profiles.
All screenshots for the store must use fictional data, never customer records.
