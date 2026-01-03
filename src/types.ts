import { TFile } from 'obsidian';

// Core interfaces and types for the LjoveS Tools plugin

export interface CustomModel {
    id: string;
    name: string;
    provider: string;
}

export interface LjoveSToolsSettings {
    provider: string;
    geminiApiKey: string;
    openaiApiKey: string;
    deepseekApiKey: string;
    model: string;
    instructionPrompt: string;
    customModels: CustomModel[]; // User-defined custom models

    // Paper Importer settings
    paperNotesFolder: string;
    paperPDFFolder: string;
    paperSystemPrompt: string;
    paperUserPrompt: string;
}

export const DEFAULT_SETTINGS: LjoveSToolsSettings = {
    provider: 'gemini',
    geminiApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    model: 'gemini-2.0-flash',
    instructionPrompt: '',
    customModels: [],

    // Paper Importer defaults
    paperNotesFolder: 'Literature Notes',
    paperPDFFolder: 'Assets',
    paperSystemPrompt: 'You are a research assistant helping academics understand and implement research papers. Provide clear, actionable summaries.',
    paperUserPrompt: `Analyze this research paper comprehensively. Structure your response with:

1. **Main Contribution**: What problem does this solve? What's novel?
2. **Methodology**: How does it work? Key algorithms/approaches?
3. **Key Findings**: Main results, metrics, comparisons
4. **Limitations**: What doesn't work well? Future work needed?
5. **Implementation Guide**: How to replicate this? Code structure, key components, practical steps

Be specific and technical where appropriate.`
};

export const AVAILABLE_MODELS = [
    // Gemini Models
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Standard)', provider: 'gemini' },

    
    // OpenAI Models
    { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', provider: 'openai' },
    { id: 'gpt-4.1-mini-2025-04-14', name: 'GPT-4.1 Mini', provider: 'openai' },
    { id: 'o4-mini-2025-04-16', name: 'o4-mini', provider: 'openai' },
    
    // DeepSeek Models
    { id: 'deepseek-chat', name: 'DeepSeek-V3-0324', provider: 'deepseek' }
];

export const PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini', apiKeyField: 'geminiApiKey' },
    { id: 'openai', name: 'OpenAI', apiKeyField: 'openaiApiKey' },
    { id: 'deepseek', name: 'DeepSeek', apiKeyField: 'deepseekApiKey' }
];

export interface TestQuestion {
    question: string;
    options: string[];
    correctAnswer: number;
    explanation?: string;
}

export interface TestData {
    questions: TestQuestion[];
    currentQuestion: number;
    selectedAnswer: number | null;
    answered: boolean;
    correctAnswers: number;
}

export interface TestResult {
    totalQuestions: number;
    correctAnswers: number;
    percentage: number;
}

export interface ImageAttachment {
    id: string;
    name: string;
    data: string; // base64 for non-Gemini providers
    size: number;
    mimeType: string;
    vaultFile?: TFile; // Vault file reference for Gemini
    filename?: string; // For compatibility with ChatManager
    vaultPath?: string;
}

export interface ChatMessage {
    id: string;
    sender?: 'user' | 'assistant'; // Original field
    role: 'user' | 'assistant' | 'system'; // New field for compatibility
    content: string;
    timestamp: Date | number;
    images?: ImageAttachment[];
    taggedNotes?: string[]; // Note names that were tagged
    rawInput?: string; // Original user input before processing
    model?: string;
}

export interface ChatSession {
    id: string;
    name: string; // "chat (1)", "chat (2)", etc.
    messages: ChatMessage[];
    instructionPrompt: string;
    model: string; // Override global setting per session
    timestamp?: number;
}