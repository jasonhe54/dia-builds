#!/usr/bin/env node

/**
 * LaunchDarkly URL Decoder & Encoder
 * Decodes and encodes base64-encoded payloads from LaunchDarkly meval URLs
 * 
 * USAGE:
 * ======
 * 
 * DECODE A URL:
 *   node launchdarkly-token.js "<launchdarkly-url>"
 * 
 * ENCODE FROM JSON FILE:
 *   node launchdarkly-token.js --encode <json-file>
 * 
 * ENCODE FROM STDIN:
 *   echo '{"kind":"multi","user":{"key":"test"}}' | node launchdarkly-token.js --encode -
 *   cat payload.json | node launchdarkly-token.js --encode -
 * 
 * WORKFLOW EXAMPLE:
 *   # 1. Decode existing URL to get JSON structure
 *   node launchdarkly-token.js "https://clientstream..." > output.txt
 *   
 *   # 2. Extract JSON from output and save to file
 *   # (copy the JSON part to payload.json)
 *   
 *   # 3. Modify payload.json as needed
 *   
 *   # 4. Generate new URL from modified JSON
 *   node launchdarkly-token.js --encode payload.json
 * 
 * MODULE USAGE:
 *   const { decodeLaunchDarklyUrl, encodeLaunchDarklyUrl } = require('./launchdarkly-token.js');
 *   
 *   // Decode
 *   const data = decodeLaunchDarklyUrl(url);
 *   
 *   // Encode
 *   const newUrl = encodeLaunchDarklyUrl(jsonData);
 */

function decodeLaunchDarklyUrl(url) {
    try {
        const urlParts = url.split('/meval/');
        if (urlParts.length !== 2) {
            throw new Error('Invalid LaunchDarkly URL format. Expected format: .../meval/{base64-payload}');
        }

        const base64Payload = urlParts[1];
        const decodedString = Buffer.from(base64Payload, 'base64').toString('utf-8');
        const parsedData = JSON.parse(decodedString);

        return parsedData;
    } catch (error) {
        throw new Error(`Failed to decode URL: ${error.message}`);
    }
}

function encodeLaunchDarklyUrl(jsonData, baseUrl = 'https://clientstream.launchdarkly.com/meval/') {
    try {
        const jsonString = JSON.stringify(jsonData);
        const base64Payload = Buffer.from(jsonString, 'utf-8').toString('base64');
        return baseUrl + base64Payload;
    } catch (error) {
        throw new Error(`Failed to encode JSON to URL: ${error.message}`);
    }
}

function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    return {
        iso: date.toISOString(),
        local: date.toLocaleString(),
        readable: date.toDateString() + ' at ' + date.toLocaleTimeString()
    };
}

function printDecodedData(data) {
    console.log('='.repeat(60));
    console.log('LAUNCHDARKLY URL DECODED DATA');
    console.log('='.repeat(60));

    console.log('\n📄 Raw JSON:');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n📱 Application Information:');
    if (data.ld_application) {
        const app = data.ld_application;
        console.log(`  Name: ${app.name || 'N/A'}`);
        console.log(`  ID: ${app.id || 'N/A'}`);
        console.log(`  Version: ${app.versionName || app.version || 'N/A'}`);
        console.log(`  Build: ${app.version || 'N/A'}`);
        console.log(`  Locale: ${app.locale || 'N/A'}`);
    }

    console.log('\n💻 Device Information:');
    if (data.ld_device) {
        const device = data.ld_device;
        console.log(`  Model: ${device.model || 'N/A'}`);
        console.log(`  Manufacturer: ${device.manufacturer || 'N/A'}`);
        console.log(`  Device ID: ${device.key || 'N/A'}`);
        if (device.os) {
            console.log(`  OS: ${device.os.name || 'N/A'} ${device.os.version || ''}`);
            console.log(`  OS Family: ${device.os.family || 'N/A'}`);
        }
    }

    console.log('\n👤 User Information:');
    if (data.user) {
        const user = data.user;
        console.log(`  User Key: ${user.key || 'N/A'}`);
        console.log(`  App Version: ${user.appVersion || 'N/A'}`);
        console.log(`  App Build: ${user.appBuildNumber || 'N/A'}`);
        if (user.createdAt) {
            const timestamp = formatTimestamp(user.createdAt);
            console.log(`  Created At: ${timestamp.readable}`);
            console.log(`  Created At (ISO): ${timestamp.iso}`);
        }
    }

    console.log('\n🔧 Technical Details:');
    console.log(`  Request Kind: ${data.kind || 'N/A'}`);
    console.log(`  Environment Attributes Version: ${data.ld_device?.envAttributesVersion || 'N/A'}`);

    console.log('\n' + '='.repeat(60));
}

function sortKeys(obj) {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((acc, key) => {
            acc[key] = sortKeys(obj[key]);
            return acc;
        }, {});
    }
    return obj;
}

function main() {
    const fs = require('fs');
    const path = require('path');
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage:');
        console.log('  Decode: node launchdarkly-token.js <launchdarkly-url>');
        console.log('  Encode: node launchdarkly-token.js --encode <json-file>');
        console.log('\nExamples:');
        console.log('  node launchdarkly-token.js "https://clientstream.launchdarkly.com/meval/eyJraW5kIjoi..."');
        console.log('  node launchdarkly-token.js --encode payload.json');
        console.log('  echo \'{"kind":"multi",...}\' | node launchdarkly-token.js --encode -');
        process.exit(1);
    }

    try {
        if (args[0] === '--encode') {
            if (args.length < 2) {
                console.error('❌ Error: Please provide a JSON file or "-" for stdin');
                process.exit(1);
            }

            let jsonData;
            if (args[1] === '-') {
                const jsonString = fs.readFileSync(0, 'utf-8');
                jsonData = JSON.parse(jsonString);
            } else {
                const jsonString = fs.readFileSync(args[1], 'utf-8');
                jsonData = JSON.parse(jsonString);
            }

            const encodedUrl = encodeLaunchDarklyUrl(jsonData);
            console.log('🔗 Generated LaunchDarkly URL:');
            console.log(encodedUrl);

        } else {
            const url = args[0];
            const decodedData = decodeLaunchDarklyUrl(url);
            printDecodedData(decodedData);

            const version = decodedData?.user?.appVersion || 'unknown-version';
            const build = decodedData?.user?.appBuildNumber || 'unknown-build';
            const outputDir = path.join(__dirname, 'outputs', 'ld-token', `${version}-${build}`);
            fs.mkdirSync(outputDir, { recursive: true });

            const outputPath = path.join(outputDir, 'decoded.json');
            const sortedJson = sortKeys(decodedData);
            fs.writeFileSync(outputPath, JSON.stringify(sortedJson, null, 2), 'utf-8');

            console.log(`\n💾 Saved decoded JSON to: ${outputPath}`);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

module.exports = {
    decodeLaunchDarklyUrl,
    encodeLaunchDarklyUrl,
    formatTimestamp,
    printDecodedData,
    sortKeys
};

if (require.main === module) {
    main();
}