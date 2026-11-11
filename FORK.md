# ScioBot fork

Package: `@lofcz/react-image-editor`. Repository: [lofcz/react-image-editor](https://github.com/lofcz/react-image-editor).

Version 1.1 wrapped the hosted Unlayer engine. Version 2 replaces it with a locally authored Canvas2D document, renderer and controls. The package contains no hosted engine code, external runtime loader or third-party canvas engine. Original wrapper attribution remains in the MIT license. Stable version 2.0.0 was published through the trusted GitHub Actions workflow.

The 1.1 fork merged these upstream pull requests with their original commits:

- [#95](https://github.com/unlayer/react-image-editor/pull/95): constrained mobile sizing and CSS hooks.
- [#83](https://github.com/unlayer/react-image-editor/pull/83): loading and retryable error surfaces.
- [#49](https://github.com/unlayer/react-image-editor/pull/49): script/global ownership during reset.

Those commits remain in history. Version 2 retains the layout/fallback intent and removes script ownership code because no script is loaded. PR #89 was not merged: its callback depended on an undocumented hosted contract. Version 2 now owns a synchronous change contract directly.

## One-time npm bootstrap

Install Node 24+, npm 11.15+, and the pinned pnpm. Run `pnpm install`, then:

```sh
npm run bootstrap:publish
```

Windows: `./bootstrap-publish.ps1`. This is a publishing command, not a local build command. It runs checks, uses interactive `npm login --auth-type=web` when necessary, publishes the current version if absent, and registers `lofcz/react-image-editor/.github/workflows/release.yml` as an npm trusted publisher. Complete npm browser login and 2FA when prompted. No token is written to the repository. Existing versions are not republished; conflicting trust configurations are reported and never revoked automatically. The owner already completed initial publication and trusted-publisher setup for version 1.1.0.

For routine releases, manually dispatch **Release and Publish to npm** on `main`, selecting patch/minor/major. The workflow validates, runs real browser checks, bumps, publishes with provenance and OIDC, pushes the release commit/tag, then creates the GitHub release. Actions must be enabled and the workflow must have repository write permission. No npm secret is required. Pushing source changes does not publish a release.

Use normal stable versions for releases and install them from npm in consuming apps. Do not vendor package archives or publish release candidates. To release a verified feature update:

```sh
gh workflow run release.yml -R lofcz/react-image-editor --ref main -f release_type=minor
```

The bootstrap is already complete; routine releases do not require npm login or a new trust configuration.

Reference: [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust).
