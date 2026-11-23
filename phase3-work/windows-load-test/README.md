# Windows public staging load runner

This runner sends synthetic guests through the actual public path:

Windows client → game-staging Worker → Access/Tunnel → Oracle staging service.

It is hard-coded to https://game-staging.itkvn.workers.dev. It cannot target the production Worker. It sends profile and movement data only; it does not submit answers, award XP, or log cookies, CSRF tokens, identities, or message bodies. It attempts to delete every guest before exit and reports cleanup success.

Preparation checks on the Oracle Linux host passed JavaScript syntax validation and the runner's help path. The PowerShell wrapper and actual public load have not run on Windows yet; those remain external verification steps.

## Before running

1. In Cloudflare Workers Analytics, check current account-wide daily Workers Free usage and confirm at least 1,000 requests of headroom. Other Workers share the 100,000/day Free allowance.
2. Use a Windows machine outside the Oracle VPS.
3. Install Node.js 24.7 or newer.
4. Copy this folder to Windows, open PowerShell in it, then install the pinned dependency:

    npm ci

5. Keep an SSH terminal open to the existing Oracle host to monitor the staging service and network. Do not change the SSH or Tunnel configuration.

If quota usage is unknown, do not run. The PowerShell wrapper requires the explicit quota confirmation argument.

## Short controlled run

The default test ramps up to five clients for 30 seconds, then 20 for 45 seconds, then 70 for five minutes. It stops ramping if a stage has HTTP 429/5xx responses, failed upgrades, unexpected disconnects, reconnect failures, or fewer connected clients than expected.

    .\run-public-load-staging.ps1 -ConfirmCloudflareQuota YES

If Windows blocks local script execution, launch a one-use PowerShell process with:

    powershell.exe -ExecutionPolicy Bypass -File .\run-public-load-staging.ps1 -ConfirmCloudflareQuota YES

The five-minute final stage is the short capacity check. For a 30-minute final stage, use:

    .\run-public-load-staging.ps1 -ConfirmCloudflareQuota YES -Final70Seconds 1800

The final duration is capped at 1,800 seconds. The report is written to reports/public-load-staging.json.

## Measurements

The report includes stage connection counts, WebSocket round-trip p50/p95/p99, planned and unexpected reconnects, HTTP status counts, WebSocket upgrade failures, movement messages, an estimated Worker request count, and guest cleanup status. It does not measure Oracle CPU, RSS, NIC bandwidth, Tunnel connector status, or Cloudflare account analytics.

During the run, capture Oracle-side service usage in the existing SSH session. For example:

    sudo systemd-cgtop --batch --iterations 420 --depth 2
    ip -s link

Use 420 iterations for the default run or 1,920 for a 30-minute final stage. Save the interface counters before and after to compare network traffic.

Check service restarts and health before and after:

    systemctl show prompt-works-staging.service -p ActiveState -p NRestarts -p MemoryCurrent -p CPUUsageNSec
    curl --fail http://127.0.0.1:3001/readyz

Record Workers Analytics before and after separately. WebSocket movement frames do not create one Worker invocation per message; each upgrade is one request. Do not publish the report as proof of 70-player capacity unless all three stages pass and the Oracle/Tunnel/Cloudflare metrics are reviewed.

The staging guest creation limit is 250 per client IP per hour. This run creates at most 70 guests and deletes them at completion. A 429 stops the run. If interrupted, rerun only after checking Cloudflare quota and staging guest cleanup.
