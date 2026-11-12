# Contributing

Thank you for considering a contribution. To report a vulnerability, follow [SECURITY.md](SECURITY.md) and don't open a public issue.

## Before you change anything

- A change to the security model must update the [security model](docs/security.md) in the same pull request.
- A schema change is a new file in `migrations/`. Applied migrations are never edited.
- A new runtime dependency needs a written reason. The Worker, the client and the widget have none today.

## Checks

```bash
npm ci
npm run check
```

That runs the TypeScript compiler, the tests inside the Workers runtime, and the package build.

## Documentation

The guides live in `docs/` as Markdown, which reads well on GitHub. `npm run docs:build` turns them into the site in `_site/`, and a new page must be added to the navigation in `site/build.mjs`. The site is deployed to GitHub Pages from `main`.

## Commits

- **Atomic commits.** One clear purpose per commit. Avoid both very large commits and a flood of one-file commits that only make sense together.
- **Conventional messages:** `feat(api):`, `fix(bot):`, `test(widget):`, `docs(readme):`, `chore(deps):`, `ci:`. Use a short imperative subject and a body that explains why.

## Licensing

Contributions are accepted under the Apache-2.0 license. Sign off each commit with `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/). There is no contributor license agreement, so the project's license can't be changed unilaterally.
