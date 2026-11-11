# ScioBot fork

Package: `@lofcz/react-image-editor`. Upstream remains credited in the MIT license.
This repository wraps the hosted Unlayer editor; it does not contain or relicense
the canvas engine. Core editing needs access to `cdn.unlayer.com`. Unlayer AI
features need a licensed project; ScioBot disables them and uses its own backend.

Merged upstream pull requests with their original commits:

- [#95](https://github.com/unlayer/react-image-editor/pull/95): constrained mobile sizing and CSS hooks.
- [#83](https://github.com/unlayer/react-image-editor/pull/83): loading and retryable error surfaces, bounded script loading.
- [#49](https://github.com/unlayer/react-image-editor/pull/49): script/global ownership during reset.

The merge keeps the timeout for all scripts and the ownership distinction for
resetting a working host script. PR #89 was not included because the hosted
engine does not promise its proposed change callback. Existing stable option
comparison already covers the relevant part of #71. No dependency sweep.

## One-time npm bootstrap

Install Node 24+, npm 11.15+, and the pinned pnpm. Run `pnpm install`, then:

```sh
node scripts/bootstrap-publish.mjs
```

Windows: `./bootstrap-publish.ps1`. The script runs checks, uses interactive
`npm login --auth-type=web` when necessary, publishes the initial version if
absent, and registers `lofcz/react-image-editor/.github/workflows/release.yml`
as an npm trusted publisher. Complete npm browser login and 2FA when prompted.
No token is written to the repository. Existing versions are not republished.
Existing conflicting trust configurations are reported by npm and never revoked
automatically.

After bootstrap, dispatch **Release and Publish to npm** on `main`, selecting
patch/minor/major. The workflow validates, bumps, publishes with provenance and
OIDC, pushes the release commit/tag, then creates the GitHub release. It needs
Actions enabled on the fork and repository workflow write permission. No npm
secret is required.

Reference: [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust).
