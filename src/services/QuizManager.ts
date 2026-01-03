import { App, Notice } from 'obsidian';
import { TestData, TestQuestion, TestResult, LjoveSToolsSettings, AVAILABLE_MODELS } from '../types';
import { MathUtils } from '../utils/MathUtils';
import { LatexRenderer } from '../utils/LatexRenderer';

/**
 * QuizManager - Handles quiz generation, testing, and results
 * Manages the entire quiz lifecycle from generation to scoring
 */
export class QuizManager {
    private app: App;
    private settings: LjoveSToolsSettings;
    private containerEl: HTMLElement;
    private latexRenderer: LatexRenderer;

    // Quiz state
    private testData: TestData | null = null;
    private isGenerating = false;

    // Callbacks
    private onCallAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
    private onGetCurrentApiKey: () => string;
    private onGetModelProvider: () => string;
    private onBackCallback?: () => void;

    constructor(
        app: App,
        settings: LjoveSToolsSettings,
        containerEl: HTMLElement,
        callbacks: {
            callAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
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
        this.onGetCurrentApiKey = callbacks.getCurrentApiKey;
        this.onGetModelProvider = callbacks.getModelProvider;
        this.onBackCallback = onBackCallback;
    }

    /**
     * Render the quiz setup interface
     * @param noteInput - Input element for note name
     * @param setupNoteSuggestions - Function to setup note suggestions
     */
    public renderSetupInterface(noteInput: HTMLInputElement, setupNoteSuggestions: () => void): void {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Generate Quiz';

        // Form
        const form = this.containerEl.createEl('div', { cls: 'ljoves-tools-form' });

        // Back button
        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        // Note name input with suggestions
        const noteInputGroup = form.createEl('div', { cls: 'ljoves-tools-input-group' });
        const noteLabel = noteInputGroup.createEl('label', { cls: 'ljoves-tools-label' });
        noteLabel.textContent = 'Note name:';

        const inputContainer = noteInputGroup.createEl('div', { cls: 'ljoves-tools-input-container' });
        const input = inputContainer.createEl('input', {
            cls: 'ljoves-tools-input',
            type: 'text',
            attr: {
                placeholder: 'Enter note with [[note name]]',
            }
        });

        // Copy the input element reference
        Object.assign(noteInput, input);

        // Setup input event listeners (delegated to parent)
        setupNoteSuggestions();

        // Question count dropdown
        const countInputGroup = form.createEl('div', { cls: 'ljoves-tools-input-group' });
        const countLabel = countInputGroup.createEl('label', { cls: 'ljoves-tools-label' });
        countLabel.textContent = 'Number of questions:';
        const countSelect = countInputGroup.createEl('select', { cls: 'ljoves-tools-select' });

        for (let i = 5; i <= 30; i += 5) {
            const option = countSelect.createEl('option');
            option.value = i.toString();
            option.textContent = i.toString();
        }

        // Generate button
        const generateButton = form.createEl('button', {
            cls: 'ljoves-tools-button',
            type: 'button'
        });
        generateButton.textContent = 'Generate Test';

        generateButton.addEventListener('click', async () => {
            const noteName = input.value.trim() || '';
            const questionCount = parseInt(countSelect.value);

            const currentApiKey = this.onGetCurrentApiKey();
            if (!currentApiKey) {
                const provider = this.onGetModelProvider();
                new Notice(`Please configure your ${provider.toUpperCase()} API key in plugin settings first`);
                return;
            }

            if (!noteName) {
                new Notice('Please enter a note name');
                return;
            }

            await this.generateTest(noteName, questionCount);
        });

        // Show API key status warning if not configured
        if (!this.onGetCurrentApiKey()) {
            const provider = this.onGetModelProvider();
            const warningEl = form.createEl('div', { cls: 'ljoves-tools-warning' });
            warningEl.innerHTML = `
                <div class="ljoves-tools-warning-icon">⚠️</div>
                <div class="ljoves-tools-warning-text">
                    <strong>API Key Required</strong><br>
                    Please configure your ${provider.toUpperCase()} API key in the plugin settings to use this feature.
                </div>
            `;
            generateButton.disabled = true;
        }
    }

    /**
     * Generate a test from a note
     */
    private async generateTest(noteName: string, questionCount: number): Promise<void> {
        if (this.isGenerating) return;

        this.isGenerating = true;
        const generateButton = this.containerEl.querySelector('.ljoves-tools-button') as HTMLButtonElement;
        if (generateButton) {
            generateButton.disabled = true;
            generateButton.textContent = 'Generating...';
        }

        try {
            // Find the note
            const noteContent = await this.getNoteContent(noteName);
            if (!noteContent) {
                new Notice(`Note "${noteName}" not found`);
                return;
            }

            // Generate questions using AI
            const questions = await this.generateQuestionsWithAI(noteContent, questionCount);

            if (questions.length === 0) {
                new Notice('Failed to generate questions');
                return;
            }

            // Initialize test data
            this.testData = {
                questions: questions,
                currentQuestion: 0,
                selectedAnswer: null,
                answered: false,
                correctAnswers: 0
            };

            // Render test interface
            await this.renderTestInterface();

        } catch (error) {
            console.error('Error generating test:', error);
            // Show user-friendly error message
            if (error.message.includes('Unable to parse valid question list')) {
                new Notice(error.message);
            } else {
                new Notice('Error generating test. Please try again.');
            }
        } finally {
            this.isGenerating = false;
            if (generateButton) {
                generateButton.disabled = false;
                generateButton.textContent = 'Generate Test';
            }
        }
    }

    /**
     * Get note content from vault
     */
    private async getNoteContent(noteName: string): Promise<string | null> {
        // Remove [[]] if present
        const cleanName = noteName.replace(/^\[\[|\]\]$/g, '');

        // Find the file
        const files = this.app.vault.getMarkdownFiles();
        const file = files.find(f =>
            f.basename === cleanName ||
            f.name === cleanName ||
            f.name === `${cleanName}.md`
        );

        if (!file) {
            return null;
        }

        return await this.app.vault.read(file);
    }

    /**
     * Generate questions using AI
     */
    private async generateQuestionsWithAI(content: string, count: number): Promise<TestQuestion[]> {
        // Detect the language of the note content
        const languageDetectionPrompt = `Analyze the following text and determine its primary language. Return only the language name in English (e.g., "English", "Serbian", "Spanish", "French", etc.):

        ${content.substring(0, 500)}...`;

        let detectedLanguage = 'English'; // Default fallback

        try {
            const apiKey = this.onGetCurrentApiKey();
            if (apiKey) {
                const provider = this.onGetModelProvider();
                const langResponse = await this.onCallAI(languageDetectionPrompt, provider, apiKey);

                if (langResponse) {
                    detectedLanguage = langResponse.trim();
                }
            }
        } catch (error) {
            console.warn('Language detection failed, using English as default:', error);
        }

        const prompt = `**IMPORTANT:** Output **only** a single JSON array of question objects. Do not include any explanatory text, markdown fences, or stray characters before or after the array.

Generate ${count} questions in ${detectedLanguage}.

REQUIRED FORMAT - Must be exactly:
[
{"q":"Question text?","opts":["A","B","C","D"],"ans":0,"exp":"Explanation"},
{"q":"Question text?","opts":["A","B","C","D"],"ans":1,"exp":"Explanation"}
]

WORKING EXAMPLES:
[
{"q":"What is 2+2?","opts":["3","4","5","6"],"ans":1,"exp":"Basic addition"},
{"q":"What is H2O?","opts":["Hydrogen","Water","Oxygen","Carbon"],"ans":1,"exp":"Chemical formula"}
]

CRITICAL RULES:
- Output ONLY the JSON array, nothing else
- Each object MUST have: "q", "opts", "ans", "exp"
- "ans" = index 0,1,2,or 3 of correct option
- Language: ${detectedLanguage}
- Math notation: $x^2$ or $$formula$$
- For matrices, use: $$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$
- IMPORTANT: Use single backslashes in JSON (they will be escaped automatically)

CONTENT:
${content}

Return exactly ${count} question objects in valid JSON array format:`;

        try {
            const apiKey = this.onGetCurrentApiKey();
            if (!apiKey) {
                throw new Error('API key not configured. Please set it in plugin settings.');
            }

            const provider = this.onGetModelProvider();
            const text = await this.onCallAI(prompt, provider, apiKey);

            if (!text) {
                throw new Error('No response from AI');
            }

            // Find the first "["
            const openPos = text.indexOf('[');
            if (openPos === -1) {
                throw new Error('No valid JSON array found in AI response');
            }

            // Walk from openPos to find the corresponding closing "]"
            let depth = 0;
            let endPos = -1;
            for (let i = openPos; i < text.length; i++) {
                if (text[i] === '[') depth++;
                else if (text[i] === ']') {
                    depth--;
                    if (depth === 0) {
                        endPos = i;
                        break;
                    }
                }
            }
            if (endPos === -1) {
                throw new Error('No valid JSON array found in AI response');
            }

            // Extract exactly that balanced JSON array
            const jsonString = text.substring(openPos, endPos + 1);

            // Properly escape backslashes for JSON parsing (especially important for matrices)
            const safeJsonString = jsonString.replace(/\\/g, '\\\\');

            // Parse and validate
            let questions: any;
            try {
                questions = JSON.parse(safeJsonString);
            } catch (err) {
                console.error('JSON parse error on escaped string:', err, safeJsonString.substring(0, 500));
                // Try without escaping as fallback
                try {
                    questions = JSON.parse(jsonString);
                } catch (err2) {
                    console.error('JSON parse error on original string:', err2, jsonString.substring(0, 500));
                    throw new Error('Unable to parse valid question list from AI response. Please try again.');
                }
            }
            if (!Array.isArray(questions) || questions.length === 0) {
                throw new Error('Unable to parse valid question list from AI response. Please try again.');
            }

            // Convert compact format to full format and validate
            const processedQuestions = questions.map(q => {
                // Handle both compact and full formats
                const question = q.q || q.question;
                const options = q.opts || q.options;
                const correctAnswer = q.ans !== undefined ? q.ans : q.correctAnswer;
                const explanation = q.exp || q.explanation;

                // Validate structure
                if (!question || !Array.isArray(options) || typeof correctAnswer !== 'number') {
                    throw new Error('Invalid question structure');
                }
                if (correctAnswer < 0 || correctAnswer >= options.length) {
                    throw new Error('Invalid correct answer index');
                }

                // Return in full format with math delimiters
                return {
                    question: MathUtils.ensureMathDelimiters(question),
                    options: options.map(option => MathUtils.ensureMathDelimiters(option)),
                    correctAnswer: correctAnswer,
                    explanation: explanation ? MathUtils.ensureMathDelimiters(explanation) : explanation
                };
            });

            return processedQuestions;

        } catch (error) {
            console.error('Error calling AI API:', error);

            // Provide user-friendly error messages
            if (error.message.includes('503')) {
                throw new Error('AI service is temporarily unavailable. Please try again in a few moments.');
            } else if (error.message.includes('401') || error.message.includes('403')) {
                throw new Error('API key is invalid or has insufficient permissions. Please check your API key in settings.');
            } else if (error.message.includes('429')) {
                throw new Error('API rate limit exceeded. Please wait a moment and try again.');
            } else if (error.message.includes('404')) {
                throw new Error('Selected model is not available. Please choose a different model in settings.');
            }

            throw error;
        }
    }

    /**
     * Render the test interface
     */
    private async renderTestInterface(): Promise<void> {
        if (!this.testData) return;

        this.containerEl.empty();
        this.containerEl.addClass('ljoves-tools-test-container');

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-test-header' });

        const title = header.createEl('div', { cls: 'ljoves-tools-test-title' });
        title.textContent = 'Study Test';

        const progress = header.createEl('div', { cls: 'ljoves-tools-test-progress' });
        progress.textContent = `Question ${this.testData.currentQuestion + 1} of ${this.testData.questions.length}`;

        // Question container
        const questionContainer = this.containerEl.createEl('div', { cls: 'ljoves-tools-question-container' });

        const currentQuestion = this.testData.questions[this.testData.currentQuestion];

        // Question text with LaTeX rendering
        const questionEl = questionContainer.createEl('div', { cls: 'ljoves-tools-question' });
        await this.latexRenderer.renderLatex(questionEl, currentQuestion.question);

        // Answers
        const answersContainer = questionContainer.createEl('div', { cls: 'ljoves-tools-answers' });

        // Process answers sequentially to maintain order
        for (let index = 0; index < currentQuestion.options.length; index++) {
            const option = currentQuestion.options[index];
            const answerEl = answersContainer.createEl('div', { cls: 'ljoves-tools-answer' });
            await this.latexRenderer.renderLatex(answerEl, option);

            if (this.testData!.answered) {
                answerEl.addClass('disabled');
                if (index === currentQuestion.correctAnswer) {
                    answerEl.addClass('correct');
                } else if (index === this.testData!.selectedAnswer) {
                    answerEl.addClass('incorrect');
                }
            } else {
                answerEl.addEventListener('click', async () => {
                    await this.selectAnswer(index);
                });
            }
        }

        // Explanation box (shown when answered incorrectly)
        if (this.testData!.answered && this.testData!.selectedAnswer !== currentQuestion.correctAnswer) {
            const explanationContainer = questionContainer.createEl('div', { cls: 'ljoves-tools-explanation' });
            const explanationTitle = explanationContainer.createEl('div', { cls: 'ljoves-tools-explanation-title' });
            explanationTitle.textContent = 'Explanation:';

            const explanationText = explanationContainer.createEl('div', { cls: 'ljoves-tools-explanation-text' });
            const explanation = currentQuestion.explanation || 'The correct answer is: ' + currentQuestion.options[currentQuestion.correctAnswer];
            await this.latexRenderer.renderLatex(explanationText, explanation);
        }

        // Actions
        const actions = this.containerEl.createEl('div', { cls: 'ljoves-tools-test-actions' });

        const backButton = actions.createEl('button', {
            cls: 'ljoves-tools-back-button',
            type: 'button'
        });
        backButton.textContent = 'Back to Setup';
        backButton.addEventListener('click', () => {
            this.testData = null;
            if (this.onBackCallback) this.onBackCallback();
        });

        const nextButton = actions.createEl('button', {
            cls: 'ljoves-tools-next-button',
            type: 'button'
        });

        if (this.testData.currentQuestion < this.testData.questions.length - 1) {
            nextButton.textContent = 'Next Question';
        } else {
            nextButton.textContent = 'Finish Test';
        }

        nextButton.disabled = !this.testData.answered;
        nextButton.addEventListener('click', async () => {
            await this.nextQuestion();
        });
    }

    /**
     * Select an answer
     */
    private async selectAnswer(answerIndex: number): Promise<void> {
        if (!this.testData || this.testData.answered) return;

        this.testData.selectedAnswer = answerIndex;
        this.testData.answered = true;

        // Check if answer is correct and update score
        const currentQuestion = this.testData.questions[this.testData.currentQuestion];
        if (answerIndex === currentQuestion.correctAnswer) {
            this.testData.correctAnswers++;
        }

        // Re-render to show the feedback
        await this.renderTestInterface();
    }

    /**
     * Move to next question or show results
     */
    private async nextQuestion(): Promise<void> {
        if (!this.testData) return;

        if (this.testData.currentQuestion < this.testData.questions.length - 1) {
            // Move to next question
            this.testData.currentQuestion++;
            this.testData.selectedAnswer = null;
            this.testData.answered = false;
            await this.renderTestInterface();
        } else {
            // Finish test - show results
            this.renderResultsScreen();
        }
    }

    /**
     * Render the results screen
     */
    private renderResultsScreen(): void {
        if (!this.testData) return;

        const result: TestResult = {
            totalQuestions: this.testData.questions.length,
            correctAnswers: this.testData.correctAnswers,
            percentage: Math.round((this.testData.correctAnswers / this.testData.questions.length) * 100)
        };

        this.containerEl.empty();
        this.containerEl.addClass('ljoves-tools-results-container');

        if (this.onBackCallback) {
            const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                if (this.onBackCallback) this.onBackCallback();
            });
        }

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-header' });
        const title = header.createEl('div', { cls: 'ljoves-tools-results-title' });
        title.textContent = 'Test Results';

        // Results content
        const resultsContent = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-content' });

        // Score display
        const scoreContainer = resultsContent.createEl('div', { cls: 'ljoves-tools-score-container' });
        const scoreText = scoreContainer.createEl('div', { cls: 'ljoves-tools-score-text' });
        scoreText.textContent = `You answered ${result.correctAnswers} out of ${result.totalQuestions} correctly!`;

        const percentageText = scoreContainer.createEl('div', { cls: 'ljoves-tools-percentage-text' });
        percentageText.textContent = `Score: ${result.percentage}%`;

        // Performance message
        const messageContainer = resultsContent.createEl('div', { cls: 'ljoves-tools-message-container' });
        const messageText = messageContainer.createEl('div', { cls: 'ljoves-tools-message-text' });

        if (result.percentage >= 90) {
            messageText.textContent = 'Tony Stark is it you? 🚀';
            messageText.addClass('smartest of all');
        } else if (result.percentage >= 70) {
            messageText.textContent = 'Great Job keep it up 🥳';
            messageText.addClass('good');
        } else if (result.percentage >= 50) {
            messageText.textContent = 'Not bad, lock in man! 🫡';
            messageText.addClass('average');
        } else {
            messageText.textContent = 'Bro you are Cooked 💀';
            messageText.addClass('cooked');
        }

        // Actions
        const actions = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-actions' });

        const newTestButton = actions.createEl('button', {
            cls: 'ljoves-tools-button',
            type: 'button'
        });
        newTestButton.textContent = 'Take Another Test';
        newTestButton.addEventListener('click', () => {
            this.testData = null;
            if (this.onBackCallback) this.onBackCallback();
        });

        const closeButton = actions.createEl('button', {
            cls: 'ljoves-tools-back-button',
            type: 'button'
        });
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
            this.testData = null;
            if (this.onBackCallback) this.onBackCallback();
        });
    }
}
