"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_KEYS = void 0;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.getApiKey = getApiKey;
exports.coerceConfigValue = coerceConfigValue;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const CONFIG_PATH = path_1.default.join(constants_1.TEAMMIND_DIR, 'config.json');
const DEFAULTS = {
    max_inject: 10,
    extraction_enabled: true,
    similarity_threshold: 0.88,
};
function loadConfig() {
    if (!(0, fs_1.existsSync)(CONFIG_PATH))
        return { ...DEFAULTS };
    try {
        const raw = JSON.parse((0, fs_1.readFileSync)(CONFIG_PATH, 'utf8'));
        return { ...DEFAULTS, ...raw };
    }
    catch {
        return { ...DEFAULTS };
    }
}
function saveConfig(config) {
    const current = loadConfig();
    const updated = { ...current, ...config };
    (0, fs_1.writeFileSync)(CONFIG_PATH, JSON.stringify(updated, null, 2));
}
function getApiKey() {
    return loadConfig().anthropic_api_key || process.env.ANTHROPIC_API_KEY;
}
// Type-coerce string values from CLI to correct types
function coerceConfigValue(key, value) {
    if (key === 'max_inject')
        return parseInt(value);
    if (key === 'extraction_enabled')
        return value === 'true' || value === '1';
    if (key === 'similarity_threshold')
        return parseFloat(value);
    return value;
}
exports.VALID_KEYS = [
    'ANTHROPIC_API_KEY',
    'max_inject',
    'extraction_enabled',
    'similarity_threshold',
];
//# sourceMappingURL=config.js.map