#!/usr/bin/env node

/**
 * Update LaunchDarkly Encode JSON with Latest EB App Version
 * ===========================================================
 * 
 * This script:
 * 1. Reads the encode.json file
 * 2. Fetches the latest Early Bird (EB) app version from the Sparkle feed
 * 3. Updates encode.json with the latest version information
 * 4. Generates updated feature flags using the updated encode.json
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
require('dotenv').config();

const ENCODE_JSON_PATH = path.join(__dirname, 'gen', 'encode.json');
const SPARKLE_FEED_URL_EB = process.env.SPARKLE_FEED_URL_EB;

if (!SPARKLE_FEED_URL_EB) {
    console.error('❌ Error: SPARKLE_FEED_URL_EB environment variable is required');
    process.exit(1);
}

/**
 * Fetches the latest version from the Sparkle feed
 * @returns {Promise<{version: string, versionName: string, buildNumber: number}>}
 */
function fetchLatestEBVersion() {
    return new Promise((resolve, reject) => {
        const url = new URL(SPARKLE_FEED_URL_EB);
        const client = url.protocol === 'https:' ? https : http;

        console.log(`📡 Fetching latest EB version from: ${SPARKLE_FEED_URL_EB}`);

        const req = client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch Sparkle feed: HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    // Parse XML feed to extract latest version
                    // The feed should have items with sparkle:version and sparkle:shortVersionString
                    const versionMatch = data.match(/<sparkle:version[^>]*>([^<]+)<\/sparkle:version>/i) ||
                                         data.match(/<version[^>]*>([^<]+)<\/version>/i);
                    const shortVersionMatch = data.match(/<sparkle:shortVersionString[^>]*>([^<]+)<\/sparkle:shortVersionString>/i) ||
                                             data.match(/<shortVersionString[^>]*>([^<]+)<\/shortVersionString>/i);

                    if (!versionMatch || !shortVersionMatch) {
                        // Try to find the first <item> and extract version info
                        const itemMatch = data.match(/<item[^>]*>([\s\S]*?)<\/item>/i);
                        if (itemMatch) {
                            const itemContent = itemMatch[1];
                            const itemVersionMatch = itemContent.match(/<sparkle:version[^>]*>([^<]+)<\/sparkle:version>/i) ||
                                                    itemContent.match(/<version[^>]*>([^<]+)<\/version>/i);
                            const itemShortVersionMatch = itemContent.match(/<sparkle:shortVersionString[^>]*>([^<]+)<\/sparkle:shortVersionString>/i) ||
                                                         itemContent.match(/<shortVersionString[^>]*>([^<]+)<\/shortVersionString>/i);

                            if (itemVersionMatch && itemShortVersionMatch) {
                                const buildNumber = parseInt(itemVersionMatch[1], 10);
                                const versionName = itemShortVersionMatch[1].trim();
                                
                                if (isNaN(buildNumber)) {
                                    reject(new Error(`Invalid build number: ${itemVersionMatch[1]}`));
                                    return;
                                }

                                console.log(`✅ Found latest EB version: ${versionName} (build ${buildNumber})`);
                                resolve({
                                    version: buildNumber.toString(),
                                    versionName: versionName,
                                    buildNumber: buildNumber
                                });
                                return;
                            }
                        }
                        reject(new Error('Could not parse version information from Sparkle feed'));
                        return;
                    }

                    const buildNumber = parseInt(versionMatch[1], 10);
                    const versionName = shortVersionMatch[1].trim();

                    if (isNaN(buildNumber)) {
                        reject(new Error(`Invalid build number: ${versionMatch[1]}`));
                        return;
                    }

                    console.log(`✅ Found latest EB version: ${versionName} (build ${buildNumber})`);
                    resolve({
                        version: buildNumber.toString(),
                        versionName: versionName,
                        buildNumber: buildNumber
                    });
                } catch (error) {
                    reject(new Error(`Failed to parse Sparkle feed: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Failed to fetch Sparkle feed: ${error.message}`));
        });

        req.end();
    });
}

/**
 * Reads and parses the encode.json file
 * @returns {Object}
 */
function readEncodeJson() {
    if (!fs.existsSync(ENCODE_JSON_PATH)) {
        throw new Error(`encode.json not found at: ${ENCODE_JSON_PATH}`);
    }

    const content = fs.readFileSync(ENCODE_JSON_PATH, 'utf8');
    return JSON.parse(content);
}

/**
 * Updates encode.json with the latest version information
 * @param {Object} encodeData - The current encode.json data
 * @param {Object} versionInfo - The latest version information
 */
function updateEncodeJson(encodeData, versionInfo) {
    // Update ld_application version fields
    if (encodeData.ld_application) {
        encodeData.ld_application.version = versionInfo.version;
        encodeData.ld_application.versionName = versionInfo.versionName;
    }

    // Update user app version fields
    if (encodeData.user) {
        encodeData.user.appVersion = versionInfo.versionName;
        encodeData.user.appBuildNumber = versionInfo.buildNumber;
    }

    return encodeData;
}

/**
 * Writes the updated encode.json file
 * @param {Object} encodeData - The updated encode.json data
 */
function writeEncodeJson(encodeData) {
    // Ensure directory exists
    const dir = path.dirname(ENCODE_JSON_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write with sorted keys for consistency
    const sortedData = sortKeys(encodeData);
    fs.writeFileSync(ENCODE_JSON_PATH, JSON.stringify(sortedData, null, 2), 'utf8');
    console.log(`✅ Updated encode.json at: ${ENCODE_JSON_PATH}`);
}

/**
 * Sorts object keys recursively for consistent JSON output
 * @param {*} obj - Object to sort
 * @returns {*} Sorted object
 */
function sortKeys(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sortKeys);
    }
    if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((sorted, key) => {
            sorted[key] = sortKeys(obj[key]);
            return sorted;
        }, {});
    }
    return obj;
}

/**
 * Generates updated feature flags using the updated encode.json
 * This triggers the feature flag fetching process
 */
async function generateUpdatedFeatureFlags() {
    const { encodeLaunchDarklyUrl } = require('../launchdarkly-token.js');
    
    const encodeData = readEncodeJson();
    const launchDarklyUrl = encodeLaunchDarklyUrl(encodeData);
    
    console.log(`🔗 Generated LaunchDarkly URL from updated encode.json`);
    console.log(`📋 URL: ${launchDarklyUrl.substring(0, 80)}...`);
    
    // Check if we should actually fetch flags (if SSE_ENDPOINT and SSE_AUTH_KEY are available)
    const sseEndpoint = process.env.SSE_ENDPOINT;
    const sseAuthKey = process.env.SSE_AUTH_KEY;
    
    if (sseEndpoint && sseAuthKey) {
        console.log(`\n🔄 Fetching updated feature flags...`);
        
        return new Promise((resolve, reject) => {
            const fetchFlagsScript = path.join(__dirname, '..', 'fetch-flags.js');
            const child = spawn('node', [fetchFlagsScript, '--update-ff-json'], {
                env: {
                    ...process.env,
                    SSE_ENDPOINT: sseEndpoint,
                    SSE_AUTH_KEY: sseAuthKey,
                    WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION: process.env.WRITE_JSON_WITHOUT_FEAT_FLAG_VERSION || 'false'
                },
                stdio: 'inherit'
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Feature flags updated successfully`);
                    resolve(launchDarklyUrl);
                } else {
                    reject(new Error(`Feature flag fetching failed with exit code ${code}`));
                }
            });
            
            child.on('error', (error) => {
                reject(new Error(`Failed to spawn feature flag fetching process: ${error.message}`));
            });
        });
    } else {
        console.log(`\n💡 SSE_ENDPOINT and SSE_AUTH_KEY not available, skipping flag fetching`);
        console.log(`   Flags will be fetched in the next workflow step`);
        return launchDarklyUrl;
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log('🚀 Starting encode.json update process...\n');

    try {
        // Step 1: Read current encode.json
        console.log('📖 Reading current encode.json...');
        const currentEncodeData = readEncodeJson();
        const currentVersion = currentEncodeData.ld_application?.version || 'unknown';
        const currentVersionName = currentEncodeData.ld_application?.versionName || 'unknown';
        console.log(`   Current version: ${currentVersionName} (build ${currentVersion})\n`);

        // Step 2: Fetch latest EB version
        const latestVersion = await fetchLatestEBVersion();
        console.log('');

        // Step 3: Check if update is needed
        const currentBuildNumber = parseInt(currentVersion, 10);
        if (!isNaN(currentBuildNumber) && currentBuildNumber >= latestVersion.buildNumber) {
            console.log(`ℹ️  Current version (${currentBuildNumber}) is up to date or newer than latest (${latestVersion.buildNumber})`);
            console.log(`   Skipping update.`);
            return;
        }

        // Step 4: Update encode.json
        console.log('✏️  Updating encode.json...');
        const updatedEncodeData = updateEncodeJson(currentEncodeData, latestVersion);
        writeEncodeJson(updatedEncodeData);
        console.log('');

        // Step 5: Generate updated feature flags
        console.log('🔄 Generating updated feature flags...');
        await generateUpdatedFeatureFlags();
        console.log('');

        console.log('✅ Process completed successfully!');
        console.log(`   Updated to version: ${latestVersion.versionName} (build ${latestVersion.buildNumber})`);

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    fetchLatestEBVersion,
    readEncodeJson,
    updateEncodeJson,
    writeEncodeJson,
    generateUpdatedFeatureFlags
};

