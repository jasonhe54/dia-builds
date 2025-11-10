const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');
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
const WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION = process.env.WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION === 'true' || false;
const OUTPUT_DIR = path.join(__dirname, 'outputs', 'feature-flags-sse-output');
const CHECK_VERSION_MODE = process.argv.includes('--check-version') || process.argv.includes('-v');
const UPDATE_LD_FEAT_FLAG_JSON = process.argv.includes('--update-ld-ff-json') || process.argv.includes('--update-ff-json');
const OUTPUT_SSE_FF_JSON = process.argv.includes('--output-sse-ff-json');

if (!SSE_ENDPOINT) {
    console.error('SSE_ENDPOINT is required in .env');
    process.exit(1);
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

function connectSSE() {
    const parsedUrl = url.parse(SSE_ENDPOINT);
    const headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    };
    if (SSE_AUTH_KEY) headers['Authorization'] = SSE_AUTH_KEY;
    if (SSE_ID_TAGS) headers['x-launchdarkly-tags'] = SSE_ID_TAGS;

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

        const truncated = SSE_ENDPOINT.length > 80
            ? SSE_ENDPOINT.slice(0, 70) + '… (truncated)'
            : SSE_ENDPOINT;
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
        console.log('SSE connection closed');
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

connectSSE();