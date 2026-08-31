# Runtime capability registry

`src/capability-registry.js` is the sole authority for abilities available to Discover, Validate, Execute, and `GET /api/capabilities`.

Capabilities describe loaded runtime adapters, their current configuration, access level, and health. Environment variables may configure an installed adapter, but a credential alone never creates a capability. For example, `GITHUB_TOKEN` does not make `github.write` available until the native GitHub adapter from #121 is installed and registered.

Statuses:

- `available`: the adapter is loaded and its required configuration is present.
- `setup_required`: the adapter exists but needs configuration or explicit enablement.
- `unavailable`: no runtime adapter or authorization exists.
- `unhealthy`: a configured adapter failed a health check.

The public snapshot contains only allowlisted metadata. Tokens, connection strings, account identifiers, and arbitrary adapter metadata are rejected. Financial movement and wallet signing remain unavailable unless separately implemented and authorized; repository merge authorization never enables them.

Workers take a fresh snapshot for each run. Discover may retain high-value setup opportunities while recording missing capabilities. Validate changes otherwise executable work to `SETUP_REQUIRED`. Execute recalculates requirements and blocks unavailable or unhealthy capabilities even if an older queue record claimed they were present.
