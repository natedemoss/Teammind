export interface TeamMindConfig {
    max_inject: number;
    extraction_enabled: boolean;
    similarity_threshold: number;
    persona_auto_update_interval: number;
}
export declare function loadConfig(): TeamMindConfig;
export declare function saveConfig(config: Partial<TeamMindConfig>): void;
export declare function coerceConfigValue(key: string, value: string): any;
export declare const VALID_KEYS: readonly ["max_inject", "extraction_enabled", "similarity_threshold", "persona_auto_update_interval"];
