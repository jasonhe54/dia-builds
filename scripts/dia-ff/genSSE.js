#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Feature Flag SSE Generator
 * ==========================
 * 
 * Modifies LaunchDarkly feature flags and generates Server-Sent Events (SSE) responses.
 * 
 * This tool reads a JSON file containing feature flags, applies specified modifications,
 * and outputs an SSE-formatted response with proper HTTP headers.
 * 
 * Usage:
 *   1. Place your feature flags JSON file as 'outputs/launchdarkly-feature-flags.json'
 *   2. Add flag names to the arrays below (flagsToSetTrue / flagsToSetFalse)
 *   3. Run: node ./scripts/dia-ff/genSSE.js
 * 
 * Output: Creates 'outputs/proxyman-local-maps/dia-launchdarkly-feature-flags.sse' with the modified flags
 */

// === CONFIGURATION ===
const DEFAULT_LD_FEAT_FLAG_JSON = path.join(__dirname, './outputs/launchdarkly-feature-flags.json');
// const OUTPUT_SSE_DATA_FILE_PATH = path.join(__dirname, 'potential-local-maps-generated/dia-launchdarkly-feature-flags.sse');

// USE THIS TO OVERWRITE THE ORIGINAL FILE
const OUTPUT_SSE_DATA_FILE_PATH = path.join(__dirname, './outputs/proxyman-local-maps/dia-launchdarkly-feature-flags.sse');

/**
 * Feature flags to enable (set to true)
 * Simply add the flag names to this array
 */
const flagsToSetTrue = [
    // "tab-presentation-badge-enabled",
    // "assistant-navigation-panel-enabled",
    // "auto-tab-title-compaction-enabled",
    // "command-bar-redesign-enabled",
    // "display-function-call-debug-info-in-supertabs",
    // "github-code-review-skill-enabled",
    // "gradient-response-thinking-animation-enabled",
    // "themed-chat-button-enabled",
    // "tool-suggestions-enabled",
    // "ultimate-notion-integration-enabled"
];

/**
 * Feature flags to disable (set to false)  
 * Simply add the flag names to this array
 */
const flagsToSetFalse = [
    "enable-e2e-encryption", // Working
    "boost-encrypt-database",
];

/**
 * Allows for settings flags with custom, non-boolean values.
 */
const otherFlagsWithCustomValues = [
    // {
    //     key: "services-referrals-invitation-limit",
    //     value: 100
    // },
];

/**
 * HTTP headers for the SSE response
 * These headers ensure proper SSE streaming behavior
 */
const SSE_HEADERS = [
    'HTTP/1.1 200 OK',
    'Content-Type: text/event-stream; charset=utf-8',
    'Cache-Control: no-cache, no-store, must-revalidate',
    'Ld-Region: us-east-1',
    ''
].join('\n');

// === HELPER FUNCTIONS ===

/**
 * Converts the simplified flag arrays into the modification format
 * @returns {Array} Array of modifications ready to apply
 */
function buildModifications() {
    const modifications = [];
    
    // Add flags to set to true
    for (const flagName of flagsToSetTrue) {
        modifications.push({
            key: flagName,
            value: { value: true }
        });
    }
    
    // Add flags to set to false
    for (const flagName of flagsToSetFalse) {
        modifications.push({
            key: flagName,
            value: { value: false }
        });
    }

    // Add other flags with custom values
    for (const { key, value } of otherFlagsWithCustomValues) {
        modifications.push({
            key: key,
            value: { value: value }
        });
    }
    
    return modifications;
}

/**
 * Validates that required files exist and are accessible
 * @throws {Error} If validation fails
 */
function validateEnvironment() {
    if (!fs.existsSync(DEFAULT_LD_FEAT_FLAG_JSON)) {
        throw new Error(`Input file not found: ${DEFAULT_LD_FEAT_FLAG_JSON}`);
    }

    // Ensure output directory exists, create if it doesn't
    const outputDir = path.dirname(OUTPUT_SSE_DATA_FILE_PATH);
    if (!fs.existsSync(outputDir)) {
        console.log(`Creating output directory: ${outputDir}`);
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Validate JSON structure
    try {
        const content = fs.readFileSync(DEFAULT_LD_FEAT_FLAG_JSON, 'utf8');
        JSON.parse(content);
    } catch (parseError) {
        throw new Error(`Invalid JSON in input file: ${parseError.message}`);
    }
}

/**
 * Applies modifications to the feature flags JSON
 * @param {Object} flagsJson - The original feature flags object
 * @param {Array} modifications - Array of modifications to apply
 * @returns {Object} Modified feature flags object
 */
function applyModifications(flagsJson, modifications) {
    const modifiedFlags = { ...flagsJson };

    console.log(`Applying ${modifications.length} modification(s):`);

    for (const { key, value } of modifications) {
        if (modifiedFlags[key]) {
            const oldValue = modifiedFlags[key].value;
            modifiedFlags[key] = {
                ...modifiedFlags[key],
                ...value
            };
            console.log(`    ${key}: ${oldValue} → ${value.value}`);
        } else {
            console.warn(`    Warning: Feature flag "${key}" not found in JSON`);
        }
    }

    return modifiedFlags;
}

/**
 * Generates SSE-formatted payload from feature flags JSON
 * @param {Object} flagsJson - The feature flags object
 * @returns {string} Complete SSE response with headers and payload
 */
function generateSSEPayload(flagsJson) {
    const eventData = `event:put\ndata:${JSON.stringify(flagsJson)}\n\n:\n:\n`;
    return `${SSE_HEADERS}\n${eventData}`;
}

/**
 * Displays a summary of what will be modified
 */
function showConfigurationSummary() {
    console.log('📋 Configuration Summary:');
    
    if (flagsToSetTrue.length > 0) {
        console.log(`    Flags to enable (${flagsToSetTrue.length}): ${flagsToSetTrue.join(', ')}`);
    }
    
    if (flagsToSetFalse.length > 0) {
        console.log(`    Flags to disable (${flagsToSetFalse.length}): ${flagsToSetFalse.join(', ')}`);
    }
    
    if (flagsToSetTrue.length === 0 && flagsToSetFalse.length === 0) {
        console.log('   No modifications configured');
    }
    
    console.log('');
}

function main() {
    console.log('Feature Flag SSE Generator');
    console.log('==============================\n');

    try {
        showConfigurationSummary();
        
        validateEnvironment();

        const modifications = buildModifications();

        console.log(`Reading feature flags from: ${DEFAULT_LD_FEAT_FLAG_JSON}`);
        const rawJson = fs.readFileSync(DEFAULT_LD_FEAT_FLAG_JSON, 'utf8');
        const originalFlags = JSON.parse(rawJson);

        const modifiedFlags = applyModifications(originalFlags, modifications);

        console.log('\nGenerating SSE response...');
        const sseResponse = generateSSEPayload(modifiedFlags);

        fs.writeFileSync(OUTPUT_SSE_DATA_FILE_PATH, sseResponse, 'utf8');

        const stats = fs.statSync(OUTPUT_SSE_DATA_FILE_PATH);
        console.log(`SSE response written to: ${OUTPUT_SSE_DATA_FILE_PATH}`);
        console.log(`Output file size: ${stats.size.toLocaleString()} bytes`);
        console.log('\nGeneration complete!');

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    applyModifications,
    generateSSEPayload,
    validateEnvironment,
    buildModifications,
    flagsToSetTrue,
    flagsToSetFalse,
    DEFAULT_LD_FEAT_FLAG_JSON,
    OUTPUT_SSE_DATA_FILE_PATH
};