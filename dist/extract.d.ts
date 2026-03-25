export interface ExtractedMemory {
    content: string;
    summary: string;
    tags: string[];
    file_paths: string[];
    functions: string[];
}
export declare function extractMemoriesFromTranscript(transcript: string, apiKey?: string): Promise<ExtractedMemory[]>;
export declare function formatTranscript(hookPayload: any): string;
