import { App, Notice } from 'obsidian';
import { LjoveSToolsSettings } from '../types';
import { LatexRenderer } from '../utils/LatexRenderer';
import { MarkdownRenderer } from '../utils/MarkdownRenderer';

/**
 * ExplainManager - Handles the "Explain Me Better" feature
 * Provides AI explanations at different complexity levels
 */
export class ExplainManager {
    private app: App;
    private settings: LjoveSToolsSettings;
    private containerEl: HTMLElement;
    private latexRenderer: LatexRenderer;

    // Explain state
    private explainLevel: 'Novice' | 'HighSchool' | 'University' | null = null;
    private explainInput: string = '';
    private explainResponseEl: HTMLElement | null = null;
    private explanationRaw: string = '';

    // Callbacks
    private onCallAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
    private onStreamExplanation: (prompt: string, provider: string, apiKey: string, responseContainer: HTMLElement, latexRenderer: LatexRenderer) => Promise<string>;
    private onGetCurrentApiKey: () => string;
    private onGetModelProvider: () => string;
    private onBackCallback?: () => void;

    constructor(
        app: App,
        settings: LjoveSToolsSettings,
        containerEl: HTMLElement,
        callbacks: {
            callAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
            streamExplanation: (prompt: string, provider: string, apiKey: string, responseContainer: HTMLElement, latexRenderer: LatexRenderer) => Promise<string>;
            getCurrentApiKey: () => string;
            getModelProvider: () => string;
        },
        onBackCallback?: () => void
    ) {
        this.app = app;
        this.settings = settings;
        this.containerEl = containerEl;
        this.latexRenderer = new LatexRenderer();

        // Bind callbacks
        this.onCallAI = callbacks.callAI;
        this.onStreamExplanation = callbacks.streamExplanation;
        this.onGetCurrentApiKey = callbacks.getCurrentApiKey;
        this.onGetModelProvider = callbacks.getModelProvider;
        this.onBackCallback = onBackCallback;
    }

    /**
     * Render the explain interface
     * @param noteInput - Input element for text/note
     * @param setupNoteSuggestions - Function to setup note suggestions
     */
    public renderInterface(noteInput: HTMLInputElement, setupNoteSuggestions: () => void): void {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-explain-container');

        // Back button (positioned absolutely in top-right)
        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Explain Me Better';

        // Level selector
        const levels = ['Novice', 'HighSchool', 'University'] as const;
        const levelLabel = this.containerEl.createEl('label', { cls: 'ljoves-tools-label' });
        levelLabel.textContent = 'Explanation Level:';

        const levelGroup = this.containerEl.createEl('div', { cls: 'level-group' });
        levels.forEach(lvl => {
            const btn = levelGroup.createEl('button', { cls: 'level-btn' });
            btn.textContent = lvl.replace('HighSchool', 'High School');
            if (this.explainLevel === lvl) {
                btn.addClass('active');
            }
            btn.addEventListener('click', () => {
                this.explainLevel = lvl;
                levelGroup.querySelectorAll('button').forEach(b => b.removeClass('active'));
                btn.addClass('active');
            });
        });

        // Response container (positioned between level selector and input)
        this.explainResponseEl = this.containerEl.createEl('div', { cls: 'explain-response' });
        this.explainResponseEl.style.display = 'none'; // Hidden initially

        this.explainResponseEl.style.overflowY = 'auto';
        this.explainResponseEl.style.flexGrow = '1';

        // Input section
        const inputSection = this.containerEl.createEl('div', { cls: 'explain-input-section' });
        const inputLabel = inputSection.createEl('label', { cls: 'ljoves-tools-label' });
        inputLabel.textContent = 'Text to Explain:';

        const inputContainer = this.containerEl.createEl('div', { cls: 'ljoves-tools-input-container' });
        const ta = inputContainer.createEl('textarea', {
            cls: 'ljoves-tools-input',
            attr: {
                placeholder: 'Enter note with [[note name]], or text',
            }
        }) as unknown as HTMLInputElement;

        // Copy the textarea element reference
        Object.assign(noteInput, ta);

        ta.addEventListener('input', () => {
            this.explainInput = ta.value;
        });

        // sizing + scrollbar
        ta.style.height = '60px';
        ta.style.maxHeight = '200px';
        ta.style.overflowY = 'auto';

        // auto-grow on Shift+Enter
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.shiftKey) {
                // after native newline
                setTimeout(() => {
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
                });
            }
        });

        // wire up the fuzzy-suggester
        setupNoteSuggestions();

        // Generate button
        const gen = this.containerEl.createEl('button', { cls: 'explain-generate' });
        gen.textContent = 'Generate Explanation';
        gen.addEventListener('click', () => this.explainText());
    }

    /**
     * Generate explanation text
     */
    private async explainText(): Promise<void> {
        if (!this.explainLevel) {
            new Notice('Please select an explanation level');
            return;
        }
        if (!this.explainInput.trim()) {
            new Notice('Please paste text to explain');
            return;
        }

        // Show and prepare response container
        this.explainResponseEl!.style.display = 'block';
        this.explainResponseEl!.empty();
        this.explainResponseEl!.createEl('div', { cls: 'loading' }).textContent = 'Loading...';

        const prompt = `You are a teacher explaining to a ${this.explainLevel === 'Novice' ? 'complete beginner'
            : this.explainLevel === 'HighSchool' ? 'high-school student'
                : 'university student'
            }.
            Explain clearly and for formulas use $$ or $ to render them:
            ${this.explainInput}
            Most importantly respond in the same language as the user's input / content.
            Don't address the user as "user" / "you" / "student" or anything like that, just give the feedback.
            `;

        try {
            const apiKey = this.onGetCurrentApiKey();
            if (!apiKey) {
                throw new Error('API key not configured. Please set it in plugin settings.');
            }

            const provider = this.onGetModelProvider();

            // Check if we can use streaming (OpenAI/DeepSeek)
            if (provider === 'openai' || provider === 'deepseek') {
                this.explanationRaw = await this.onStreamExplanation(prompt, provider, apiKey, this.explainResponseEl!, this.latexRenderer);
                this.addExplanationActions();
            } else {
                // Fallback to non-streaming for Gemini
                const response = await this.onCallAI(prompt, provider, apiKey);
                this.explanationRaw = response || '';
                this.explainResponseEl!.empty();
                if (response) {
                    await this.latexRenderer.renderLatexWithMarkdown(this.explainResponseEl!, response, MarkdownRenderer.renderMarkdown);
                    this.addExplanationActions();
                }
            }
        } catch (error) {
            console.error('Error generating explanation:', error);
            this.explainResponseEl!.empty();
            this.explainResponseEl!.createEl('div', { cls: 'error' }).textContent = 'Error generating explanation. Please try again.';
        }
    }

    /**
     * Add action buttons after explanation is generated
     */
    private addExplanationActions(): void {
        // After streaming ends, add Copy & Create Note buttons
        const actionBar = this.explainResponseEl!.createEl('div', { cls: 'explain-actions' });

        const copyBtn = actionBar.createEl('button', { cls: 'copy-btn' });
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.explanationRaw);
            new Notice('Raw Markdown copied');
        });

        const newNoteBtn = actionBar.createEl('button', { cls: 'newnote-btn' });
        newNoteBtn.textContent = 'Create New Note';
        newNoteBtn.addEventListener('click', async () => {
            // Derive a clean title from the first non-empty line:
            const firstLine = this.explanationRaw
                .split('\n')
                .find(l => l.trim().length > 0)
                ?.replace(/[^a-zA-Z0-9 ]/g, '')
                .trim() || 'New Note';

            const fileName = `${firstLine}.md`;
            try {
                const file = await this.app.vault.create(fileName, this.explanationRaw);
                this.app.workspace.openLinkText(file.basename, file.path);
                new Notice(`Created note: ${file.basename}`);
            } catch (e) {
                console.error(e);
                new Notice('Error creating note');
            }
        });
    }
}
