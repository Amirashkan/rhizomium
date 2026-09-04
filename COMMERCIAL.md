# Commercial licensing

Rhizomium is published under the [GNU Affero General Public License v3.0 or
later](LICENSE). That licence is a genuine offer: you may run it, study it,
modify it and redistribute it, for any purpose including commercial ones, for
free and forever.

The AGPL asks one thing in return. If you modify Rhizomium and let other people
use your modified version over a network, you must offer those users the source
of your modifications under the same licence. Running it privately — on your
laptop, at a show, in a studio, for a client — triggers nothing at all. This
page is only about the case where the AGPL does not suit you.

## What is not covered by the AGPL

Two things in this project are services rather than code you host:

- **The gallery** (`art.tenderworld.org`) — accounts, patch sharing, plans and
  billing. It is a separate, closed codebase. Nothing in this repository
  requires it: the editor runs, renders and saves `.rz` patches with no
  account and no network.
- **The hosted AI backend.** `api/` in this repository is AGPL like the rest,
  and you are free to deploy it yourself against your own OpenAI key. What is
  not free is *our* deployment of it, and the model usage it pays for. That is
  what a plan buys. See [AI_TIER_INTEGRATION.md](docs/internal/AI_TIER_INTEGRATION.md).

The name **Rhizomium**, the name **Tenderworld**, and the logos in `assets/`
are not licensed under the AGPL. See [NOTICE](NOTICE).

## Buying a commercial licence

As the copyright holder, AMIRASHKAN KHODAVERDINEJAD MOLLAEI can license
Rhizomium under terms other than the AGPL. The usual reason to want that is
redistribution: you want to embed Rhizomium in a product you ship, or offer a
modified version as a hosted service, without publishing your changes.

If that is you, write to **me@ashkankhodaverdi.com** with a sentence or two
about what you are building. There is no price list; for small studios and
artists there is usually no charge.

## Contributing, and why we ask for a sign-off

Selling commercial licences only works if we hold the rights to the whole
codebase, so [CONTRIBUTING.md](CONTRIBUTING.md) asks you to sign off your
commits under the Developer Certificate of Origin. That certifies you wrote
the patch and may submit it under the AGPL — it does **not** assign us your
copyright. You keep it.

The practical consequence is that a commercial licence we sell covers the code
we wrote plus contributions whose authors agreed to it. If we ever need to
relicense code you contributed, we will ask you, by name, and you may say no.
