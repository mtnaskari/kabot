# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/mtnaskari/kabot/security/advisories/new). Don't open a public issue.

Include the affected version or commit, the steps to reproduce, and the impact you expect. You will receive an acknowledgement within a week.

## Supported versions

Only the latest release receives security fixes.

## Scope

The security model is described in the [README](README.md#security-model). Reports are especially welcome about:

- submitting messages to a site from an origin that is not allowed, or without passing Turnstile;
- reading or changing messages from a chat that is not linked to their site;
- recovering API keys, pairing codes, Turnstile secrets or visitor IP addresses from stored data;
- forging bot webhook requests.

Abuse that stays within the configured rate limits, and attacks that need the `ADMIN_TOKEN`, `KABOT_SECRET` or access to the Cloudflare account, are out of scope.
