# Dynamic LaunchDarkly Endpoint Configuration

## Overview

The feature flag fetcher now supports **dynamic endpoint generation**, allowing it to automatically fetch feature flags for the latest Early Bird build of Dia Browser without manual updates.

## How It Works

1. Fetches the Sparkle RSS feed for Early Bird builds
2. Parses the feed to extract the latest version and build number
3. Generates a LaunchDarkly SSE endpoint URL with the latest build info encoded
4. Uses that endpoint to fetch current feature flags

## Required GitHub Secrets

Add these secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

### Required for Dynamic Generation (New)

| Secret | Description | Example |
|--------|-------------|---------|
| `SPARKLE_FEED_URL_EB` | URL to the Early Bird Sparkle feed | `https://.../appcast.xml` |
| `LD_USER_KEY` | Unique user identifier for LaunchDarkly | `abc123def456` |
| `LD_DEVICE_KEY` | Unique device identifier | `device-xyz789` |
| `LD_DEVICE_MODEL` | Device model identifier | `MacBookPro` |
| `LD_APPLICATION_KEY` | Application key for LaunchDarkly | `X35-6-kkrwIMqzRZDHyxezsqjizBZbbxTADyKoHmkIo=` |
| `SSE_AUTH_KEY` | Authorization key for LaunchDarkly | `api_key mob-...` |

**Note:** `SSE_ID_TAGS` is now automatically generated in dynamic mode based on the current build version from the Sparkle feed. You don't need to manually update it anymore.

### Existing Secrets (Still Used)

| Secret | Description |
|--------|-------------|
| `DIA_FF_SSE_ENDPOINT` | Static fallback endpoint (optional if using dynamic) |
| `DIA_FF_SSE_AUTH_KEY` | Authorization key for LaunchDarkly |

## Environment Variables

For local development, add to `.env`:

```bash
# Dynamic endpoint generation
SPARKLE_FEED_URL_EB=https://your-feed-url/appcast.xml
LD_USER_KEY=your-user-key
LD_DEVICE_KEY=your-device-key
LD_DEVICE_MODEL=Mac15,9

# Optional: Force static endpoint mode
USE_DYNAMIC_ENDPOINT=false

# Optional: Custom LaunchDarkly base URL
LD_ENDPOINT_BASE=https://clientstream.launchdarkly.com/meval/
```

## How to Get Device Info

To get the correct values for `LD_USER_KEY`, `LD_DEVICE_KEY`, `LD_DEVICE_MODEL`, and `LD_APPLICATION_KEY`:

1. Use the Dia Browser app
2. Monitor network traffic (using ProxyMan or Charles)
3. Look for requests to `clientstream.launchdarkly.com/meval/`
4. Decode the URL using the existing script:
   ```bash
   node scripts/dia-ff/launchdarkly-token.js "https://clientstream.launchdarkly.com/meval/..."
   ```
5. Extract the values from the decoded JSON:
   - `user.key` → `LD_USER_KEY`
   - `ld_device.key` → `LD_DEVICE_KEY`
   - `ld_device.model` → `LD_DEVICE_MODEL`
   - `ld_application.key` → `LD_APPLICATION_KEY`

## Behavior

### Dynamic Mode (Default when SSE_ENDPOINT is not set)
- Fetches latest Early Bird build from Sparkle feed
- Generates fresh endpoint with current build info
- Falls back to static `SSE_ENDPOINT` if dynamic generation fails

### Static Mode
- Use existing `SSE_ENDPOINT` from secrets
- Enabled automatically if `SSE_ENDPOINT` is set
- Can force with `--static-endpoint` flag or `USE_DYNAMIC_ENDPOINT=false`

## Usage

```bash
# Install new dependency
npm install

# Run with dynamic endpoint (default)
npm run update-ff

# Run with static endpoint
USE_DYNAMIC_ENDPOINT=false npm run update-ff

# Force dynamic mode even if SSE_ENDPOINT is set
npm run update-ff -- --dynamic-endpoint
```

## Workflow Updates

The GitHub Actions workflow (`track-feat-flags.yml`) has been updated to:
- Pass new secrets to the fetch script
- Use repository variable `USE_DYNAMIC_ENDPOINT` to control mode
- Default to dynamic mode (`true`) if variable is not set

Set the repository variable:
- Go to `Settings > Secrets and variables > Variables`
- Add `USE_DYNAMIC_ENDPOINT` = `true` or `false`
