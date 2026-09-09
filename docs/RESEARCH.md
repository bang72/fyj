# MIVO product research

Research date: 3 September 2026. The goal was to extract durable interaction and safety principles, not copy another product's visual system.

## What the research changed

| Area | Observed pattern | MIVO decision |
| --- | --- | --- |
| First use | Social products reduce setup before the core action, but unsafe anonymous products also remove too much friction. | Registration is short, yet date of birth is validated server-side and under-18 accounts cannot be created. Recovery codes are shown once. |
| Discovery | Swipe-heavy interfaces bias profile judgment. | The first viewport is a vibe chooser with one primary action. No feed, cards, follower counts, or public popularity signals. |
| Safety | Mature products keep block/report close to the conversation and let a specific message be reported. | A Shield is always visible in chat. Block is immediate, ends the room, prevents rematching, and report evidence is snapshotted with a retention limit. |
| Privacy | Controls work best when they are contextual and reversible. | Identity fields never ship to the other client before the mutual server-side unlock. Region is coarse and opt-in. |
| Trust | Verification badges can be overinterpreted. | The optional badge says “Verified Human” and its explanation explicitly says it is not a safety guarantee. The feature is absent until a provider is configured. |
| Ephemerality | Clear deletion expectations reduce ambiguity. | Both people choose retention. The shorter choice wins unless both explicitly choose Keep. Expiry is shown in plain language. |
| Messaging | Delivery/read state, reply, reconnect, and pagination are expected basics. | Messages receive a monotonic room sequence, history is cursor-paginated, sending is optimistic, and failures are retryable. |
| Notifications | Permission prompts perform better after value is understood. | MIVO never prompts on first launch; notification controls live in Profile and can be offered after a connection event. |
| Mobile | Bottom navigation and generous targets reduce reach strain. | Four-item bottom navigation, 48px targets, safe-area padding, sticky composer, and no horizontal overflow. |
| Accessibility | WCAG 2.2 adds focus visibility, target-size, and accessible authentication guidance. | Semantic controls, visible focus, AA contrast, reduced motion, labels, keyboard send, and no color-only status. |

## Primary references

- [Tinder Safety](https://tinder.com/safety-tips/) — verification must not be presented as a guarantee; block, unmatch, and report remain close at hand.
- [Tinder Photo Check privacy](https://www.help.tinder.com/hc/en-us/articles/26147205007885-Photo-Check-data-and-privacy-information) — verification requires explicit data-purpose and retention treatment.
- [Bumble Incognito Mode](https://support.bumble.com/hc/en-us/articles/30009906379165-Using-incognito-mode) — privacy controls should be understandable and reversible.
- [Bumble blocking flow](https://support.bumble.com/hc/en-us/articles/28783382700701-Blocking-someone) — block and report are related but should not be forced into the same outcome.
- [Telegram FAQ](https://telegram.org/faq) and [Snapchat chat retention](https://help.snapchat.com/hc/en-us/articles/7012334940948-When-does-Snapchat-delete-Snaps-and-Chats) — temporary conversation behavior needs an explicit, predictable policy.
- [Reddit reporting a chat message](https://support.reddithelp.com/hc/en-us/articles/360043035472-How-do-I-report-a-chat-message) and [Snapchat reporting](https://help.snapchat.com/hc/en-us/articles/7012399221652-How-do-I-report-abuse-illegal-content-or-other-violations-on-Snapchat) — specific-message reporting preserves useful context.
- [eSafety: risks in anonymous random chat](https://www.esafety.gov.au/newsroom/blogs/stranger-danger-20-how-anonymous-random-chat-app-platforms-are-putting-children-at-risk) and [Safety by Design](https://www.esafety.gov.au/industry/safety-by-design) — safety is a product constraint, not a post-launch add-on.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [mobile guidance](https://www.w3.org/TR/wcag2mobile-22/) — accessibility baseline.
- [web.dev PWA checklist](https://web.dev/articles/pwa-checklist) — installability, offline fallback, and honest degraded-state behavior.
- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) — HTTP Postgres transport for Vercel/edge runtimes.
- [Ably token authentication](https://ably.com/docs/auth) — short-lived, narrowly scoped client authorization for optional realtime.

## Visual thesis

“Midnight rendezvous”: a calm near-black stage with two luminous orbs that approach each other. The supplied MIVO logo is the visual anchor. Cyan identifies discovery, magenta identifies mutual consent, and violet bridges the two; gradients are reserved for signature moments and the main action. Surfaces are flat and spacious rather than nested glass cards.
