"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.EMBED_DIM = exports.EMBED_MODEL = exports.HAIKU_MODEL = exports.MAX_INJECT_MEMORIES = exports.HOOKS_DIR = exports.MODEL_CACHE_DIR = exports.DB_PATH = exports.TEAMMIND_DIR = void 0;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
exports.TEAMMIND_DIR = path_1.default.join(os_1.default.homedir(), '.teammind');
exports.DB_PATH = path_1.default.join(exports.TEAMMIND_DIR, 'db.sqlite');
exports.MODEL_CACHE_DIR = path_1.default.join(exports.TEAMMIND_DIR, 'model-cache');
exports.HOOKS_DIR = path_1.default.join(exports.TEAMMIND_DIR, 'hooks');
exports.MAX_INJECT_MEMORIES = 10;
exports.HAIKU_MODEL = 'claude-haiku-4-5-20251001';
exports.EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
exports.EMBED_DIM = 384;
exports.VERSION = '0.1.0';
//# sourceMappingURL=constants.js.map