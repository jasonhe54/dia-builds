const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');
const { parseStringPromise } = require('xml2js');
require('dotenv').config();

// ANSI color map
const colors = {
    reset: '\x1b[0m',
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

const SSE_ENDPOINT = process.env.SSE_ENDPOINT;
const SSE_AUTH_KEY = process.env.SSE_AUTH_KEY;
const SSE_ID_TAGS = process.env.SSE_ID_TAGS;
const SPARKLE_FEED_URL_EB = process.env.SPARKLE_FEED_URL_EB;
const LD_ENDPOINT_BASE = process.env.LD_ENDPOINT_BASE || 'https://clientstream.launchdarkly.com/meval/';

// GitHub Secrets for sensitive LaunchDarkly payload data
const LD_USER_KEY = process.env.LD_USER_KEY;
const LD_DEVICE_KEY = process.env.LD_DEVICE_KEY;
const LD_DEVICE_MODEL = process.env.LD_DEVICE_MODEL;
const LD_APPLICATION_KEY = process.env.LD_APPLICATION_KEY;

const WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION = process.env.WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION === 'true' || false;
const OUTPUT_DIR = path.join(__dirname, 'outputs', 'feature-flags-sse-output');
const CHECK_VERSION_MODE = process.argv.includes('--check-version') || process.argv.includes('-v');
const UPDATE_LD_FEAT_FLAG_JSON = process.argv.includes('--update-ld-ff-json') || process.argv.includes('--update-ff-json');
const OUTPUT_SSE_FF_JSON = process.argv.includes('--output-sse-ff-json');
const USE_DYNAMIC_ENDPOINT = !SSE_ENDPOINT || process.argv.includes('--dynamic-endpoint') || process.env.USE_DYNAMIC_ENDPOINT === 'true';

/**
 * Fetches the Sparkle feed and returns the parsed XML
 */
function fetchSparkleFeed(feedUrl) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(feedUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            port: parsedUrl.port || 443,
            method: 'GET',
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml',
                'User-Agent': 'Dia-Builds-Feature-Flag-Tracker/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

/**
 * Parses Sparkle XML feed and returns the latest build info
 */
async function parseSparkleFeed(xmlData) {
    try {
        // Clean up malformed XML attributes
        const cleanedXml = xmlData
            .replace(/xmlns:_xmlns="xmlns" /g, '')
            .replace(/_xmlns:/g, 'xmlns:');

        const result = await parseStringPromise(cleanedXml, {
            explicitArray: false,
            mergeAttrs: false
        });

        const channel = result.rss?.channel;
        if (!channel || !channel.item) {
            throw new Error('No items found in feed');
        }

        const items = Array.isArray(channel.item) ? channel.item : [channel.item];
        
        // Find the latest non-delta enclosure
        const latestItem = items[0]; // Items are typically sorted newest first
        
        const enclosure = Array.isArray(latestItem.enclosure) 
            ? latestItem.enclosure.find(e => !e.$?.['sparkle:deltaFrom'])
            : latestItem.enclosure;

        // Extract values, handling both string and object formats from xml2js
        const buildNum = extractStringValue(latestItem['sparkle:version']) || 
                        extractStringValue(latestItem['version']);
        const shortVersion = extractStringValue(latestItem['sparkle:shortVersionString']) || 
                            extractStringValue(latestItem['shortVersionString']);
        
        if (!buildNum || !shortVersion) {
            console.error('Debug - latestItem:', JSON.stringify(latestItem, null, 2));
            throw new Error(`Could not extract version info. buildNum=${buildNum}, shortVersion=${shortVersion}`);
        }
        
        return {
            buildNum: buildNum,
            shortVersionStr: shortVersion,
            description: extractStringValue(latestItem.description) || '',
            pubDate: extractStringValue(latestItem.pubDate)
        };
    } catch (error) {
        throw new Error(`Failed to parse Sparkle feed: ${error.message}`);
    }
}

/**
 * Helper to extract string value from xml2js parsed data
 */
function extractStringValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        // xml2js sometimes wraps text content in _ property
        if (value._) return String(value._);
        // Or it might be an array
        if (Array.isArray(value)) return String(value[0] || '');
        // Or just convert to string
        return String(value);
    }
    return String(value);
}

/**
 * Generates SSE ID tags header based on build info
 * Format: "application-id/company.thebrowser.dia application-name/Dia application-version/{build} application-version-name/{version}"
 */
function generateSSEIdTags(buildInfo) {
    const tags = [
        `application-id/company.thebrowser.dia`,
        `application-name/Dia`,
        `application-version/${buildInfo.buildNum}`,
        `application-version-name/${buildInfo.shortVersionStr}`
    ];
    return tags.join(' ');
}

/**
 * Generates a LaunchDarkly endpoint URL dynamically
 */
function generateLaunchDarklyEndpoint(buildInfo) {
    // Check for required secrets
    if (!LD_USER_KEY) {
        throw new Error('LD_USER_KEY is required in environment to generate dynamic endpoint');
    }
    if (!LD_DEVICE_KEY) {
        throw new Error('LD_DEVICE_KEY is required in environment to generate dynamic endpoint');
    }
    if (!LD_DEVICE_MODEL) {
        throw new Error('LD_DEVICE_MODEL is required in environment to generate dynamic endpoint');
    }
    if (!LD_APPLICATION_KEY) {
        throw new Error('LD_APPLICATION_KEY is required in environment to generate dynamic endpoint');
    }

    // Get current timestamp for createdAt
    const createdAt = new Date().toISOString();
    
    // Parse version string (e.g., "1.32.0" -> "1320")
    const versionParts = buildInfo.shortVersionStr.split('.');
    const major = versionParts[0] || '1';
    const minor = versionParts[1] || '0';
    const patch = versionParts[2] || '0';
    const buildNumberForUser = `${major}${minor}${patch}`;

    // Construct the payload matching LaunchDarkly's expected format
    const payload = {
        kind: "multi",
        user: {
            key: LD_USER_KEY,
            appBuildNumber: parseInt(buildInfo.buildNum) || 1,
            appVersion: buildNumberForUser,
            createdAt: createdAt
        },
        ld_application: {
            key: LD_APPLICATION_KEY,
            id: "company.thebrowser.dia",
            name: "Dia",
            version: buildInfo.buildNum,
            versionName: buildInfo.shortVersionStr,
            locale: "en_US",
            envAttributesVersion: "1.0"
        },
        ld_device: {
            key: LD_DEVICE_KEY,
            manufacturer: "Apple",
            model: LD_DEVICE_MODEL,
            envAttributesVersion: "1.0",
            os: {
                family: "Apple",
                name: "macOS",
                version: "26.2.0"
            }
        }
    };

    // Encode to base64 and create URL
    const jsonString = JSON.stringify(payload);
    const base64Payload = Buffer.from(jsonString, 'utf-8').toString('base64');
    const endpointUrl = LD_ENDPOINT_BASE + base64Payload;

    // Generate dynamic SSE ID tags
    const sseIdTags = generateSSEIdTags(buildInfo);

    console.log(`${colors.green}✓ Generated dynamic endpoint for:${colors.reset}`);
    console.log(`  Version: ${buildInfo.shortVersionStr} (Build ${buildInfo.buildNum})`);
    console.log(`  User Key: ${LD_USER_KEY.substring(0, 8)}...`);
    console.log(`  Device Model: ${LD_DEVICE_MODEL}`);
    console.log(`  SSE ID Tags: ${sseIdTags}`);

    return { endpointUrl, sseIdTags };
}

/**
 * Gets the LaunchDarkly SSE endpoint (dynamic or static)
 * Returns object with { endpointUrl, sseIdTags }
 */
async function getSSEEndpoint() {
    if (!USE_DYNAMIC_ENDPOINT && SSE_ENDPOINT) {
        console.log(`${colors.blue}ℹ Using static SSE endpoint from environment${colors.reset}`);
        return { endpointUrl: SSE_ENDPOINT, sseIdTags: SSE_ID_TAGS };
    }

    if (!SPARKLE_FEED_URL_EB) {
        throw new Error('SPARKLE_FEED_URL_EB is required to fetch latest Early Bird build info');
    }

    console.log(`${colors.blue}ℹ Fetching latest Early Bird build from Sparkle feed...${colors.reset}`);
    
    try {
        const xmlData = await fetchSparkleFeed(SPARKLE_FEED_URL_EB);
        const buildInfo = await parseSparkleFeed(xmlData);
        
        console.log(`${colors.green}✓ Found latest build: ${buildInfo.shortVersionStr} (${buildInfo.buildNum})${colors.reset}`);
        
        const { endpointUrl, sseIdTags } = generateLaunchDarklyEndpoint(buildInfo);
        return { endpointUrl, sseIdTags };
    } catch (error) {
        console.error(`${colors.red}✗ Failed to generate dynamic endpoint: ${error.message}${colors.reset}`);
        
        if (SSE_ENDPOINT) {
            console.log(`${colors.yellow}⚠ Falling back to static SSE endpoint${colors.reset}`);
            return { endpointUrl: SSE_ENDPOINT, sseIdTags: SSE_ID_TAGS };
        }
        
        throw error;
    }
}

if (!CHECK_VERSION_MODE && !fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sortKeys(obj) {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((sorted, key) => {
            sorted[key] = sortKeys(obj[key]);
            return sorted;
        }, {});
    }
    return obj;
}

function saveSortedJSON(eventType, rawJsonStr) {
    try {
        const parsed = JSON.parse(rawJsonStr);
        const sorted = sortKeys(parsed);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${OUTPUT_DIR}/${eventType || 'event'}-${timestamp}.json`;

        if (OUTPUT_SSE_FF_JSON) {
            fs.writeFileSync(filename, JSON.stringify(sorted, null, 4));
            console.log(`Saved sorted JSON for event '${eventType}' at ${timestamp}`);
        }

        if (UPDATE_LD_FEAT_FLAG_JSON) {
            const ldFilePath = path.join(__dirname, 'outputs', 'launchdarkly-feature-flags.json');
            fs.writeFileSync(ldFilePath, JSON.stringify(sorted, null, 4));
            console.log(`Updated LaunchDarkly feature flag JSON at ${ldFilePath}`);
        }

        if (WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION) {
            const noVersion = JSON.parse(JSON.stringify(sorted));
            for (const key in noVersion) {
                if (noVersion[key].version) {
                    delete noVersion[key].version;
                }
            }
            const noVersionFilename = path.join(__dirname, 'outputs', 'darkly-feature-flags.no-version.json');
            fs.writeFileSync(noVersionFilename, JSON.stringify(noVersion, null, 4));
            console.log(`Saved JSON without version at ${noVersionFilename}`);
        }
    } catch (err) {
        console.error('Failed to parse/save SSE:', err.message);
    }
}

function printVersionFromJSON(rawJsonStr) {
    try {
        const parsed = JSON.parse(rawJsonStr);
        const [firstKey, firstVal] = Object.entries(parsed)[0] || [];

        if (!firstVal) {
            console.warn('No flags found in response.');
            return;
        }

        const version = firstVal.version ?? firstVal.flagVersion ?? 'N/A';
        console.log(`Feature Flag Version: ${colors.cyan}${version}${colors.reset}`);
    } catch (err) {
        console.error('Failed to parse JSON for version check:', err.message);
    }
}

let req = null;
let currentEndpoint = null;
let currentSseIdTags = null;

async function connectSSE() {
    try {
        const endpointData = await getSSEEndpoint();
        currentEndpoint = endpointData.endpointUrl;
        currentSseIdTags = endpointData.sseIdTags;
    } catch (error) {
        console.error(`${colors.red}✗ Cannot connect: ${error.message}${colors.reset}`);
        process.exit(1);
    }

    const parsedUrl = url.parse(currentEndpoint);
    const headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    };
    if (SSE_AUTH_KEY) headers['Authorization'] = SSE_AUTH_KEY;
    if (currentSseIdTags) headers['x-launchdarkly-tags'] = currentSseIdTags;

    req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        port: parsedUrl.port || 443,
        method: 'GET',
        headers
    }, res => {
        if (res.statusCode !== 200) {
            console.error(`Connection failed: HTTP ${res.statusCode}`);
            return;
        }

        const truncated = currentEndpoint.length > 80
            ? currentEndpoint.slice(0, 70) + '… (truncated)'
            : currentEndpoint;
        console.log(`Connected to ${truncated}`);

        let buffer = '';
        let currentEvent = null;
        let currentData = '';
        let braceDepth = 0;
        let collectingData = false;

        res.on('data', chunk => {
            const chunkStr = chunk.toString();
            buffer += chunkStr;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop(); // hold incomplete line

            for (const line of lines) {
                if (line.startsWith('event:')) {
                    currentEvent = line.slice(6).trim();
                    if (currentEvent === 'put') {
                        collectingData = true;
                        braceDepth = 0;
                        currentData = '';
                    }
                } else if (line.startsWith('data:')) {
                    if (!collectingData) continue;
                    const content = line.slice(5).trim();
                    currentData += content;
                    for (const char of content) {
                        if (char === '{') braceDepth++;
                        else if (char === '}') braceDepth--;
                    }
                    if (braceDepth === 0 && currentData.length > 0) {
                        if (CHECK_VERSION_MODE) {
                            printVersionFromJSON(currentData);
                        } else {
                            saveSortedJSON(currentEvent, currentData);
                        }
                        shutdown(); // Exit after first full message
                        collectingData = false;
                        currentData = '';
                    }
                } else if (line.trim() === '' && collectingData && braceDepth === 0) {
                    if (currentData.length > 0) {
                        if (CHECK_VERSION_MODE) {
                            printVersionFromJSON(currentData);
                        } else {
                            saveSortedJSON(currentEvent, currentData);
                        }
                        shutdown();
                    }
                    collectingData = false;
                    currentData = '';
                }
            }
        });

        res.on('error', err => {
            console.error('Stream error:', err.message);
        });

        res.on('end', () => {
            console.log('SSE connection closed');
        });
    });

    req.on('error', err => {
        console.error('Request error:', err.message);
    });

    req.end();
}

// Graceful shutdown
function shutdown() {
    console.log('Shutting down gracefully...');
    if (req) {
        req.abort?.();
        req.destroy?.();
        console.log('SSE connection closed');
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the connection
connectSSE().catch(err => {
    console.error(`${colors.red}✗ Fatal error: ${err.message}${colors.reset}`);
    process.exit(1);
});