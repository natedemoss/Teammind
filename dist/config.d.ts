export interface TeamMindConfig {
    anthropic_api_key?: string;
    max_inject: number;
    extraction_enabled: boolean;
    similarity_threshold: number;
}
export declare function loadConfig(): TeamMindConfig;
export declare function saveConfig(config: Partial<TeamMindConfig>): void;
export declare function getApiKey(): string | undefined;
export declare function coerceConfigValue(key: string, value: string): any;
export declare const VALID_KEYS: readonly ["ANTHROPIC_API_KEY", "max_inject", "extraction_enabled", "similarity_threshold"];
