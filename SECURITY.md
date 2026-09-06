# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Amirashkan/rhizomium/security/advisories/new),
or email **security@tenderworld.org** — that address is not routed yet, so
until it is, write to **me@ashkankhodaverdi.com** instead.

Please include what you found, how to reproduce it, and what an attacker gets
out of it. A proof of concept helps a great deal.

You can expect an acknowledgement within a few days and an honest estimate of
when it will be fixed. If you would like credit in the advisory, say so and
tell us the name to use.

This is a small project run by a small team; there is no bug bounty. What there
is, is a real commitment to fixing what you find and crediting you for it.

## What is in scope

The parts of this repository where a bug has real consequences:

**Tier and grant verification** — `api/_lib/grant.js`, `api/ai/run.js`,
`src/collab/collabGrant.js`. This is the boundary that makes the repository
safe to publish. Of particular interest:

- Forging or replaying a grant without `TIER_GRANT_SECRET`.
- Getting a feature the grant does not authorise (the feature must come from
  the grant, never from the request body).
- Reaching the debug-grant path on a deployment that has not enabled it.
- Anything that reveals `OPENAI_API_KEY` or `TIER_GRANT_SECRET` to a browser.

**Patch loading** — `.rz` patches are untrusted input. The editor opens files
written on other people's machines, and a published patch is opened by
strangers. Anything that turns a patch into code execution matters:

- Escaping the expression AST interpreter
  (`src/utils/UnifiedExpressionSystem.js`) into arbitrary JavaScript.
- Bypassing the Content-Security-Policy in `editor/index.html` or
  `viewer/index.html`.
- XSS through node labels, parameter values or patch metadata.

**The local bridges** — `osc_bridge_server.py`, `ndi_bridge_server.py`,
`rhizo_server.py`, `collab_room_server.py`. They listen on localhost, so any
page in the browser can reach them. Path traversal, command execution, or
overly permissive CORS on these is in scope.

**Collaboration** — `src/collab/`, `collab_room_server.py`: joining a room you
were not invited to, or reading another session's data.

## What is not in scope

- **Tier values being editable in devtools.** This is by design. The browser is
  assumed hostile; `src/ai/tiers.js` decides what to *draw*, and the server
  decides what to *do*. A lit-up button that returns 401 is the system working.
  A request that actually *succeeds* without a valid grant is very much in
  scope.
- Findings against `art.tenderworld.org` — that is a separate codebase. Send
  those to the same address and they will be routed.
- Missing hardening headers with no demonstrated impact.
- Vulnerabilities in dependencies with no path to exploitation here — please
  report those upstream.
- Denial of service by giving the GPU too much work. It is a GPU tool; you can
  always ask it for more than your hardware can do.

## Supported versions

Fixes go onto `main` and into the next release. There are no long-term support
branches — this is pre-1.0 software.
