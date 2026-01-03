import { App, Notice } from 'obsidian';
import { LjoveSToolsSettings } from '../types';

/**
 * RecapManager - Handles the Recap feature
 * Generates open-ended questions and provides AI feedback
 */
export class RecapManager {
    private app: App;
    private settings: LjoveSToolsSettings;
    private containerEl: HTMLElement;

    // Recap state
    private recapContent: string = '';
    private recapCount: number = 1;
    private recapQuestions: string[] = [];
    private recapIndex: number = 0;
    private recapFeedback: string[] = [];
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private recognizing = false;
    private loaderInterval: number | undefined = undefined;

    // Callbacks
    private onCallAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
    private onGetCurrentApiKey: () => string;
    private onGetModelProvider: () => string;
    private onTranscribeAudio: (blob: Blob) => Promise<string>;
    private onBackCallback?: () => void;

    constructor(
        app: App,
        settings: LjoveSToolsSettings,
        containerEl: HTMLElement,
        callbacks: {
            callAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
            getCurrentApiKey: () => string;
            getModelProvider: () => string;
            transcribeAudio: (blob: Blob) => Promise<string>;
        },
        onBackCallback?: () => void
    ) {
        this.app = app;
        this.settings = settings;
        this.containerEl = containerEl;

        // Bind callbacks
        this.onCallAI = callbacks.callAI;
        this.onGetCurrentApiKey = callbacks.getCurrentApiKey;
        this.onGetModelProvider = callbacks.getModelProvider;
        this.onTranscribeAudio = callbacks.transcribeAudio;
        this.onBackCallback = onBackCallback;
    }

    /**
     * Render the recap initialization interface
     * @param noteInput - Input element for text/note
     * @param setupNoteSuggestions - Function to setup note suggestions
     */
    public renderInitInterface(noteInput: HTMLInputElement, setupNoteSuggestions: () => void): void {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('recap-container');

        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Recap';

        const inputLabel = this.containerEl.createEl('label', { cls: 'ljoves-tools-label' });
        inputLabel.textContent = 'Text / File to Recap:';

        // Textarea for file/text
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
            this.recapContent = ta.value;
        });

        // sizing + scrollbar
        ta.style.height = '60px';
        ta.style.maxHeight = '200px';
        ta.style.overflowY = 'auto';

        // auto-grow on Shift+Enter
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.shiftKey) {
                setTimeout(() => {
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
                });
            }
        });

        // wire up the fuzzy-suggester
        setupNoteSuggestions();

        const countLabel = this.containerEl.createEl('label', { cls: 'ljoves-tools-label' });
        countLabel.textContent = 'Number of questions to generate:';

        // Count dropdown 1–4
        const countSelect = this.containerEl.createEl('select', { cls: 'ljoves-tools-select' });
        [1, 2, 3, 4].forEach(n => {
            const opt = countSelect.createEl('option');
            opt.value = String(n);
            opt.textContent = String(n);
        });
        countSelect.value = String(this.recapCount);
        countSelect.addEventListener('change', () => this.recapCount = parseInt(countSelect.value));

        // Generate button
        const gen = this.containerEl.createEl('button', { cls: 'ljoves-tools-button' });
        gen.textContent = 'Generate Questions';
        gen.addEventListener('click', () => this.generateRecapQuestions());
    }

    /**
     * Generate recap questions
     */
    private async generateRecapQuestions(): Promise<void> {
        if (!this.recapContent.trim()) {
            new Notice('Please paste some text or a note name');
            return;
        }
        this.containerEl.empty();
        this.containerEl.createEl('div', { cls: 'ljoves-tools-loading' }).textContent = 'Generating questions…';

        const prompt = `
      Read the following content and generate exactly ${this.recapCount} open-ended recap questions for the user to answer:
      Only generate questions, no other text.
      Answer the questions in the same language as the content.
      Depending on ${this.recapCount}, ensure the questions are relevant and cover the entire content.

      ${this.recapContent}
      `;
        const apiKey = this.onGetCurrentApiKey();
        const provider = this.onGetModelProvider();
        const raw = await this.onCallAI(prompt, provider, apiKey) || '';
        try {
            this.recapQuestions = JSON.parse(raw);
        } catch {
            // fallback: split by newline
            this.recapQuestions = raw.trim().split(/\n+/).slice(0, this.recapCount);
        }
        this.recapIndex = 0;
        this.recapFeedback = [];
        this.renderRecapQuestion();
    }

    /**
     * Render a single recap question
     */
    public renderRecapQuestion(): void {
        this.containerEl.empty();

        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-test-progress' });
        header.textContent = `Recap: Question ${this.recapIndex + 1} of ${this.recapCount}`;

        // Question box
        const qBox = this.containerEl.createEl('div', { cls: 'recap-question-box' });
        qBox.textContent = this.recapQuestions[this.recapIndex];

        // Input + Send + Mic
        const inputSection = this.containerEl.createEl('div', { cls: 'recap-input-section' });
        const input = inputSection.createEl('textarea', { cls: 'ljoves-tools-input' });

        const mic = inputSection.createEl('button', { cls: 'recap-mic-btn' });
        const hasOpenAI = Boolean(this.settings.openaiApiKey.trim());
        mic.disabled = !hasOpenAI;
        mic.style.opacity = hasOpenAI ? '1' : '0.5';
        mic.title = hasOpenAI
            ? (this.recognizing ? 'Stop recording' : 'Start recording')
            : 'Require OpenAI API key for voice';

        mic.type = 'button';
        // initial state:
        mic.textContent = '🎤';
        mic.title = 'Start recording';
        mic.disabled = !this.settings.openaiApiKey;
        if (mic.disabled) {
            mic.style.opacity = '0.5';
            mic.title = 'OpenAI key required for transcription';
        }

        mic.addEventListener('click', async () => {
            // If disabled, do nothing
            if (!this.settings.openaiApiKey) return;

            if (!this.recognizing) {
                // → START RECORDING
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioChunks = [];
                this.mediaRecorder = new MediaRecorder(stream);
                this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);

                // show ✍️ while we're transcribing
                this.mediaRecorder.onstop = async () => {
                    mic.textContent = '✍️';
                    mic.title = 'Transcribing…';

                    try {
                        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                        const transcript = await this.onTranscribeAudio(blob);
                        input.value = (input.value + ' ' + transcript).trim();
                    } catch (err) {
                        // errors already handled by transcribeAudio Notice
                    } finally {
                        this.recognizing = false;
                        mic.textContent = '🎤';
                        mic.title = 'Start recording';
                    }
                };

                this.mediaRecorder.start();
                this.recognizing = true;
                mic.textContent = '⏹️';
                mic.title = 'Stop recording';
            } else {
                // → STOP RECORDING
                this.mediaRecorder?.stop();
            }
        });

        const sendBtn = inputSection.createEl('button', { cls: 'ljoves-tools-button' });
        sendBtn.textContent = 'Send';
        sendBtn.addEventListener('click', () => this.handleRecapAnswer(input.value));

        // show feedback + Next/Finish button
        const fb = this.recapFeedback[this.recapIndex];
        if (fb) {
            // feedback box
            const fbBox = this.containerEl.createEl('div', { cls: 'recap-feedback' });
            fbBox.textContent = fb;

            // Next / Finish
            const next = this.containerEl.createEl('button', { cls: 'ljoves-tools-next-button' });
            next.textContent = this.recapIndex + 1 < this.recapCount ? 'Next' : 'Finish';
            next.addEventListener('click', () => {
                if (this.recapIndex + 1 < this.recapCount) {
                    this.recapIndex++;
                    this.renderRecapQuestion();
                } else {
                    this.renderRecapSummary();
                }
            });
        }
    }

    /**
     * Handle answer submission
     */
    private async handleRecapAnswer(answer: string): Promise<void> {
        if (!answer.trim()) {
            new Notice('Please enter an answer or use voice input');
            return;
        }

        this.startLoader();
        // show loading
        this.recapFeedback[this.recapIndex] = 'hmm let me think...';
        this.renderRecapQuestion();

        const prompt = `
      User answered: "${answer}"
      Question: "${this.recapQuestions[this.recapIndex]}"
      Based on the original content, give concise feedback to user, don't use markdown, and be 100% honest, have in mind that user is human and not a genius and need to know basics.
      Look from answer if the user understood in general the material/content about the question.
      Don't address the user as "user", just give the feedback.
      Response in the same language as the user's answer.
      `;
        const apiKey = this.onGetCurrentApiKey();
        const provider = this.onGetModelProvider();
        const fb = await this.onCallAI(prompt, provider, apiKey) || 'No feedback.';
        this.recapFeedback[this.recapIndex] = fb.trim();
        this.stopLoader();
        this.renderRecapQuestion();
    }

    /**
     * Start animated loader
     */
    private startLoader(): void {
        let dotCount = 0;
        this.loaderInterval = window.setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            const dots = '.'.repeat(dotCount);
            this.recapFeedback[this.recapIndex] = `hmm let me think${dots}`;
            this.renderRecapQuestion();
        }, 400);
    }

    /**
     * Stop animated loader
     */
    private stopLoader(): void {
        if (this.loaderInterval != null) {
            clearInterval(this.loaderInterval);
            this.loaderInterval = undefined;
        }
    }

    /**
     * Render the recap summary
     */
    private renderRecapSummary(): void {
        this.containerEl.empty();

        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        const title = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-title' });
        title.textContent = `Recap Complete!`;

        const list = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-content' });
        this.recapQuestions.forEach((q, i) => {
            const qEl = list.createEl('div', { cls: 'math-block' });
            qEl.textContent = `Q${i + 1}: ${q}`;
            const aEl = list.createEl('div');
            aEl.textContent = `Your answer: ${this.recapFeedback[i]}`;
        });

        const done = this.containerEl.createEl('button', { cls: 'ljoves-tools-button' });
        done.textContent = 'Back to Menu';
        done.addEventListener('click', () => {
            this.recapQuestions = [];
            this.recapFeedback = [];
            if (this.onBackCallback) this.onBackCallback();
        });
    }
}
