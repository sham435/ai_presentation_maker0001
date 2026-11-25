# Branch protection recommendations

Apply these settings to `main` when repository admin permissions are available.

## Required checks

- `CI Verification / verify`
- `CI Verification / dependency-audit`
- `Electron E2E / e2e`
- `Visual Regression / visual`
- `Security / security`

## Rules

- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require branches to be up to date before merging.
- Do not allow force pushes or deletions.
- Include administrators.
- Require signed commits if the team has signing configured.

## Notes

The current token used to configure this repository does not include organization or project scopes. Branch protection must be applied by an administrator through repository settings or an admin-scoped token.
