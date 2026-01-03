import { Plugin, WorkspaceLeaf, ItemView, TFile, Notice, App, PluginSettingTab, Setting, FuzzySuggestModal, Modal, normalizePath } from 'obsidian';
import { ChatManager } from './src/services/ChatManager';
import { AIService } from './src/services/AIService';
import { ImageService } from './src/services/ImageService';
import { QuizManager } from './src/services/QuizManager';
import { ExplainManager } from './src/services/ExplainManager';
import { RecapManager } from './src/services/RecapManager';
import { PaperImporterManager, PaperAnalysis } from './src/services/PaperImporterManager';
import { AlphaXivService } from './src/services/AlphaXivService';
import { NoteSuggester, ChatNoteSuggester } from './src/components/NoteSuggester';
import { LjoveSToolsSettings, TestQuestion, TestData, TestResult, ImageAttachment, ChatMessage, ChatSession, DEFAULT_SETTINGS, AVAILABLE_MODELS, PROVIDERS } from './src/types';
import { LatexRenderer } from './src/utils/LatexRenderer';
import { MathUtils } from './src/utils/MathUtils';
import { MarkdownRenderer } from './src/utils/MarkdownRenderer';


const VIEW_TYPE_LJOVES = 'ljoves-tools-view';

console.log('LjoveS Tools plugin loaded Version 1.0.0');




export default class LjoveSToolsPlugin extends Plugin {
    settings: LjoveSToolsSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_LJOVES,
            (leaf) => new LjoveSToolsView(leaf, this.settings)
        );

        this.addRibbonIcon('brain', 'LjoveS Tools', (evt: MouseEvent) => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-ljoves-tools',
            name: 'Open LjoveS Tools',
            callback: () => {
                this.activateView();
            }
        });

        // Add settings tab
        this.addSettingTab(new LjoveSToolsSettingTab(this.app, this));

        // Open the view by default
        this.activateView();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        
        // Update view with new settings if it exists
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LJOVES);
        if (leaves.length > 0) {
            const view = leaves[0].view as LjoveSToolsView;
            view.updateSettings(this.settings);
        }
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_LJOVES);
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_LJOVES);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_LJOVES, active: true });
        }

        workspace.revealLeaf(leaf);
    }
}


class LjoveSToolsView extends ItemView {
    private settings: LjoveSToolsSettings;
    private selectedCategory: 'chat' | 'study' | 'research' | null = null;
    private selectedFeature: 'quiz' | 'explain' | 'recap' | null = null;
    private noteInput: HTMLInputElement;

    // Services
    private aiService: AIService;
    private imageService: ImageService;
    private latexRenderer: LatexRenderer;
    private alphaXivService: AlphaXivService;

    // Feature Managers
    private chatManager: ChatManager | null = null;
    private quizManager: QuizManager | null = null;
    private explainManager: ExplainManager | null = null;
    private recapManager: RecapManager | null = null;
    private paperImporterManager: PaperImporterManager | null = null;

    // Paper Importer state
    private paperAnalysis: PaperAnalysis | null = null;
    private paperSystemPrompt: string = '';
    private paperUserPrompt: string = '';
    private enableAlphaXiv: boolean = false;

    constructor(leaf: WorkspaceLeaf, settings: LjoveSToolsSettings) {
        super(leaf);
        this.settings = settings;
        this.aiService = new AIService(settings);
        this.imageService = new ImageService(this.app);
        this.alphaXivService = new AlphaXivService();
        this.latexRenderer = new LatexRenderer();
        this.noteInput = document.createElement('input');
    }

    updateSettings(settings: LjoveSToolsSettings) {
        this.settings = settings;
        this.aiService.updateSettings(settings);
        this.render();
    }

    getViewType() {
        return VIEW_TYPE_LJOVES;
    }

    getDisplayText() {
        return 'LjoveS Tools';
    }

    async onOpen() {
        this.containerEl.empty();
        this.render();
    }

    private render() {
        // Feature level (deepest)
        if (this.selectedFeature) {
            switch (this.selectedFeature) {
                case 'quiz':
                    this.renderQuizInterface();
                    break;
                case 'explain':
                    this.renderExplainInterface();
                    break;
                case 'recap':
                    this.renderRecapInterface();
                    break;
            }
            return;
        }

        // Category level
        if (this.selectedCategory) {
            switch (this.selectedCategory) {
                case 'chat':
                    this.renderChatInterface();
                    break;
                case 'study':
                    this.renderStudySubmenu();
                    break;
                case 'research':
                    this.renderResearchSubmenu();
                    break;
            }
            return;
        }

        // Main menu (top level)
        this.renderMainMenu();
    }

    async onClose() {
        // Clean up if needed
    }

    // ============================================
    // FEATURE RENDERING - Delegates to Managers
    // ============================================

    private renderChatInterface() {
        // Setup container with proper CSS classes for full height
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-chat-container');

        if (!this.chatManager) {
            this.chatManager = new ChatManager(
                this.app,
                this.settings,
                this.containerEl,
                {
                    streamAI: this.aiService.streamAI.bind(this.aiService),
                    getCurrentApiKey: this.aiService.getCurrentApiKey.bind(this.aiService),
                    getModelProvider: this.aiService.getModelProvider.bind(this.aiService),
                    saveImageToVault: this.imageService.saveImageToVault.bind(this.imageService),
                    processDroppedImage: this.imageService.processDroppedImage.bind(this.imageService),
                    getImageFromClipboard: this.imageService.getImageFromClipboard.bind(this.imageService),
                    handleFileUrl: this.imageService.handleFileUrl.bind(this.imageService),
                    renderMarkdown: (text: string) => MarkdownRenderer.renderMarkdown(text)
                },
                () => {
                    this.selectedCategory = null;
                    this.render();
                }
            );
        }
        this.chatManager.renderChatInterface();
    }

    private renderQuizInterface() {
        if (!this.quizManager) {
            this.quizManager = new QuizManager(
                this.app,
                this.settings,
                this.containerEl,
                {
                    callAI: this.aiService.callAI.bind(this.aiService),
                    getCurrentApiKey: this.aiService.getCurrentApiKey.bind(this.aiService),
                    getModelProvider: this.aiService.getModelProvider.bind(this.aiService)
                },
                () => {
                    this.selectedFeature = null;
                    this.render();
                }
            );
        }
        this.quizManager.renderSetupInterface(this.noteInput, () => this.setupNoteSuggestions());
    }

    private renderExplainInterface() {
        if (!this.explainManager) {
            this.explainManager = new ExplainManager(
                this.app,
                this.settings,
                this.containerEl,
                {
                    callAI: this.aiService.callAI.bind(this.aiService),
                    streamExplanation: (prompt: string, provider: string, apiKey: string, responseContainer: HTMLElement, latexRenderer: LatexRenderer) =>
                        this.streamExplanation(prompt, provider, apiKey, responseContainer, latexRenderer),
                    getCurrentApiKey: this.aiService.getCurrentApiKey.bind(this.aiService),
                    getModelProvider: this.aiService.getModelProvider.bind(this.aiService)
                },
                () => {
                    this.selectedFeature = null;
                    this.render();
                }
            );
        }
        this.explainManager.renderInterface(this.noteInput, () => this.setupNoteSuggestions());
    }

    private renderRecapInterface() {
        if (!this.recapManager) {
            this.recapManager = new RecapManager(
                this.app,
                this.settings,
                this.containerEl,
                {
                    callAI: this.aiService.callAI.bind(this.aiService),
                    getCurrentApiKey: this.aiService.getCurrentApiKey.bind(this.aiService),
                    getModelProvider: this.aiService.getModelProvider.bind(this.aiService),
                    transcribeAudio: (blob: Blob) => this.transcribeAudio(blob)
                },
                () => {
                    this.selectedFeature = null;
                    this.render();
                }
            );
        }
        this.recapManager.renderInitInterface(this.noteInput, () => this.setupNoteSuggestions());
    }

    private renderMainMenu() {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'LjoveS Tools';

        // Main categories
        const categoriesContainer = this.containerEl.createEl('div', { cls: 'ljoves-tools-features' });

        const hasApiKey = !!this.aiService.getCurrentApiKey();

        // Chat - Direct access
        const chatBtn = categoriesContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        chatBtn.innerHTML = `
            <div class="feature-icon">💬</div>
            <div class="feature-title">Chat</div>
            <div class="feature-desc">Talk with AI about anything</div>
        `;
        chatBtn.disabled = !hasApiKey;
        chatBtn.addEventListener('click', () => {
            this.selectedCategory = 'chat';
            this.render();
        });

        // Study - Submenu
        const studyBtn = categoriesContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        studyBtn.innerHTML = `
            <div class="feature-icon">📚</div>
            <div class="feature-title">Study</div>
            <div class="feature-desc">Quiz, recap & explanations</div>
        `;
        studyBtn.disabled = !hasApiKey;
        studyBtn.addEventListener('click', () => {
            this.selectedCategory = 'study';
            this.render();
        });

        // Research - Placeholder for future
        const researchBtn = categoriesContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        researchBtn.innerHTML = `
            <div class="feature-icon">🔬</div>
            <div class="feature-title">Research</div>
            <div class="feature-desc">Paper importer & analysis</div>
        `;
        researchBtn.disabled = !hasApiKey;
        researchBtn.addEventListener('click', () => {
            this.selectedCategory = 'research';
            this.render();
        });

        // API key warning
        if (!hasApiKey) {
            const provider = this.aiService.getModelProvider();
            const providerName = PROVIDERS.find(p => p.id === provider)?.name || provider.toUpperCase();

            const warningEl = this.containerEl.createEl('div', { cls: 'ljoves-tools-warning' });
            warningEl.innerHTML = `
                <div class="ljoves-tools-warning-icon">⚠️</div>
                <div class="ljoves-tools-warning-text">
                    <strong>API Key Required</strong><br>
                    Configure your ${providerName} API key in settings to continue.
                </div>
            `;
        }
    }

    private renderStudySubmenu() {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        // Back button
        const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', () => {
            this.selectedCategory = null;
            this.render();
        });

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Study';

        // Study features
        const featuresContainer = this.containerEl.createEl('div', { cls: 'ljoves-tools-features' });

        // Recap
        const recapBtn = featuresContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        recapBtn.innerHTML = `
            <div class="feature-icon">🔄</div>
            <div class="feature-title">Recap</div>
            <div class="feature-desc">Answer questions to test retention</div>
        `;
        recapBtn.addEventListener('click', () => {
            this.selectedFeature = 'recap';
            this.render();
        });

        // Quiz
        const quizBtn = featuresContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        quizBtn.innerHTML = `
            <div class="feature-icon">📝</div>
            <div class="feature-title">Quiz</div>
            <div class="feature-desc">Generate multiple choice tests</div>
        `;
        quizBtn.addEventListener('click', () => {
            this.selectedFeature = 'quiz';
            this.render();
        });

        // Explain
        const explainBtn = featuresContainer.createEl('button', { cls: 'ljoves-tools-feature-btn' });
        explainBtn.innerHTML = `
            <div class="feature-icon">💡</div>
            <div class="feature-title">Explain</div>
            <div class="feature-desc">Get explanations at your level</div>
        `;
        explainBtn.addEventListener('click', () => {
            this.selectedFeature = 'explain';
            this.render();
        });
    }

    private renderResearchSubmenu() {
        if (this.paperAnalysis) {
            // Step 2: Show analysis and configuration
            this.renderPaperConfiguration();
        } else {
            // Step 1: Input URL
            this.renderPaperInput();
        }
    }

    private renderPaperInput() {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        // Back button
        const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', () => {
            this.selectedCategory = null;
            this.paperAnalysis = null;
            this.render();
        });

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Paper Importer';

        // Input form
        const form = this.containerEl.createEl('div', { cls: 'ljoves-tools-form' });

        const inputLabel = form.createEl('label', { cls: 'ljoves-tools-label' });
        inputLabel.textContent = 'Paper URL or arXiv ID:';

        const input = form.createEl('input', {
            cls: 'ljoves-tools-input',
            type: 'text',
            attr: { placeholder: 'e.g., 1706.03762 or https://arxiv.org/abs/1706.03762' }
        });

        // Advanced Scraping checkbox
        const advancedContainer = form.createDiv({ cls: 'ljoves-tools-checkbox-container' });
        const advancedCheckbox = advancedContainer.createEl('input', {
            type: 'checkbox',
            attr: { style: 'margin-right: 8px;' }
        });
        const advancedLabel = advancedContainer.createEl('label', {
            text: 'Advanced Scraping (AlphaXiv) - Get AI summary, podcast & transcript',
            attr: { style: 'cursor: pointer;' }
        });

        advancedCheckbox.addEventListener('change', () => {
            this.enableAlphaXiv = advancedCheckbox.checked;
        });

        const loadButton = form.createEl('button', {
            cls: 'ljoves-tools-button',
            type: 'button'
        });
        loadButton.textContent = 'Load Paper';

        loadButton.addEventListener('click', async () => {
            const urlInput = input.value.trim();
            if (!urlInput) {
                new Notice('Please enter a paper URL or arXiv ID');
                return;
            }

            await this.loadPaper(urlInput);
        });

        // Show API key warning if needed
        if (!this.aiService.getCurrentApiKey()) {
            const provider = this.aiService.getModelProvider();
            const providerName = PROVIDERS.find(p => p.id === provider)?.name || provider.toUpperCase();

            const warningEl = form.createEl('div', { cls: 'ljoves-tools-warning' });
            warningEl.innerHTML = `
                <div class="ljoves-tools-warning-icon">⚠️</div>
                <div class="ljoves-tools-warning-text">
                    <strong>API Key Required</strong><br>
                    Configure your ${providerName} API key in settings to generate summaries.
                </div>
            `;
            loadButton.disabled = true;
        }
    }

    private async loadPaper(urlInput: string) {
        if (!this.paperImporterManager) {
            this.paperImporterManager = new PaperImporterManager(
                this.app,
                this.settings,
                this.containerEl,
                {
                    callAI: this.aiService.callAI.bind(this.aiService),
                    streamAI: this.aiService.streamAI.bind(this.aiService),
                    getCurrentApiKey: this.aiService.getCurrentApiKey.bind(this.aiService),
                    getModelProvider: this.aiService.getModelProvider.bind(this.aiService)
                },
                () => {
                    this.selectedCategory = null;
                    this.paperAnalysis = null;
                    this.render();
                }
            );
        }

        // Show loading screen
        this.renderLoadingScreen('Fetching metadata...');

        try {
            // Extract arXiv ID
            const arxivId = this.paperImporterManager.extractArxivId(urlInput);
            if (!arxivId) {
                new Notice('Invalid arXiv URL or ID format');
                this.render();
                return;
            }

            // Fetch metadata
            this.renderLoadingScreen('✓ Fetched metadata\n⏳ Downloading PDF...');
            const metadata = await this.paperImporterManager.fetchPaperMetadata(arxivId);

            // Download PDF
            const pdfFile = await this.paperImporterManager.downloadPDF(
                metadata.pdfUrl,
                metadata.title,
                this.settings.paperPDFFolder
            );

            // Extract text
            this.renderLoadingScreen('✓ Fetched metadata\n✓ Downloaded PDF\n⏳ Extracting text...');
            const textContent = await this.paperImporterManager.extractPDFText(pdfFile);

            // Count tokens
            this.renderLoadingScreen('✓ Fetched metadata\n✓ Downloaded PDF\n✓ Extracted text\n⏳ Analyzing tokens...');
            const tokenCount = this.paperImporterManager.estimateTokens(textContent);

            // Store analysis
            this.paperAnalysis = {
                metadata,
                pdfFile,
                textContent,
                tokenCount
            };

            // Initialize prompts from settings
            this.paperSystemPrompt = this.settings.paperSystemPrompt;
            this.paperUserPrompt = this.settings.paperUserPrompt;

            // Show configuration screen
            this.render();

        } catch (error) {
            console.error('Error loading paper:', error);
            new Notice(`Failed to load paper: ${error.message}`);
            this.paperAnalysis = null;
            this.render();
        }
    }

    private renderLoadingScreen(message: string) {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        const loadingContainer = this.containerEl.createEl('div', {
            cls: 'ljoves-tools-loading',
            attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 20px;' }
        });

        const spinner = loadingContainer.createEl('div', {
            attr: { style: 'font-size: 48px;' }
        });
        spinner.textContent = '⏳';

        const messageEl = loadingContainer.createEl('div', {
            attr: { style: 'white-space: pre-line; text-align: center; color: var(--text-muted);' }
        });
        messageEl.textContent = message;
    }

    private renderPaperConfiguration() {
        if (!this.paperAnalysis) {
            this.render();
            return;
        }

        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        // Back button
        const backBtn = this.containerEl.createEl('button', { cls: 'ljoves-tools-back-button' });
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', () => {
            this.paperAnalysis = null;
            this.render();
        });

        // Header
        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Paper Importer';

        // Paper info
        const paperInfo = this.containerEl.createEl('div', { cls: 'paper-info', attr: { style: 'margin: 20px 0; padding: 16px; background: var(--background-secondary); border-radius: 8px;' } });

        const title = paperInfo.createEl('div', { attr: { style: 'font-size: 1.1em; font-weight: 600; margin-bottom: 8px;' } });
        title.textContent = `📄 ${this.paperAnalysis.metadata.title}`;

        const authors = paperInfo.createEl('div', { attr: { style: 'color: var(--text-muted); margin-bottom: 4px;' } });
        authors.textContent = `👥 ${this.paperAnalysis.metadata.authors.slice(0, 3).join(', ')}${this.paperAnalysis.metadata.authors.length > 3 ? ' et al.' : ''}`;

        const date = paperInfo.createEl('div', { attr: { style: 'color: var(--text-muted);' } });
        date.textContent = `📅 ${this.paperAnalysis.metadata.date.split('T')[0]}`;

        // Token analysis
        const tokenInfo = this.containerEl.createEl('div', { cls: 'token-info', attr: { style: 'margin: 20px 0; padding: 12px 16px; background: var(--background-primary-alt); border-radius: 6px; border-left: 3px solid var(--interactive-accent);' } });

        const tokenTitle = tokenInfo.createEl('div', { attr: { style: 'font-weight: 600; margin-bottom: 4px;' } });
        tokenTitle.textContent = '📊 Token Analysis';

        const tokenCount = tokenInfo.createEl('div', { attr: { style: 'color: var(--text-muted);' } });
        tokenCount.textContent = `PDF Text: ~${this.paperAnalysis.tokenCount.toLocaleString()} tokens`;

        // Model selector
        const form = this.containerEl.createEl('div', { cls: 'ljoves-tools-form' });

        const modelLabel = form.createEl('label', { cls: 'ljoves-tools-label' });
        modelLabel.textContent = 'AI Model:';

        const modelSelect = form.createEl('select', { cls: 'ljoves-tools-select' });

        // Group models by provider
        const groupedModels = new Map<string, typeof AVAILABLE_MODELS>();
        AVAILABLE_MODELS.concat(this.settings.customModels).forEach(model => {
            if (!groupedModels.has(model.provider)) {
                groupedModels.set(model.provider, []);
            }
            groupedModels.get(model.provider)!.push(model);
        });

        groupedModels.forEach((models, provider) => {
            const optgroup = modelSelect.createEl('optgroup', { attr: { label: provider.toUpperCase() } });
            models.forEach(model => {
                const option = optgroup.createEl('option', { value: model.id });
                option.textContent = model.name;
                if (model.id === this.settings.model) {
                    option.selected = true;
                }
            });
        });

        // System prompt
        const systemLabel = form.createEl('label', { cls: 'ljoves-tools-label' });
        systemLabel.textContent = 'System Prompt: (optional)';

        const systemPromptContainer = form.createEl('div', { attr: { style: 'position: relative;' } });
        const systemPrompt = systemPromptContainer.createEl('textarea', {
            cls: 'ljoves-tools-input',
            attr: { placeholder: 'System prompt for the AI...', rows: '3' }
        });
        systemPrompt.value = this.paperSystemPrompt;
        systemPrompt.addEventListener('input', () => {
            this.paperSystemPrompt = systemPrompt.value;
        });

        const useDefaultSystem = systemPromptContainer.createEl('button', {
            cls: 'use-default-btn',
            type: 'button',
            attr: { style: 'position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 0.85em;' }
        });
        useDefaultSystem.textContent = 'Use Default ↺';
        useDefaultSystem.addEventListener('click', () => {
            systemPrompt.value = this.settings.paperSystemPrompt;
            this.paperSystemPrompt = this.settings.paperSystemPrompt;
        });

        // User prompt
        const userLabel = form.createEl('label', { cls: 'ljoves-tools-label' });
        userLabel.textContent = 'User Instructions: (optional)';

        const userPromptContainer = form.createEl('div', { attr: { style: 'position: relative;' } });
        const userPrompt = userPromptContainer.createEl('textarea', {
            cls: 'ljoves-tools-input',
            attr: { placeholder: 'Instructions for how to analyze the paper...', rows: '6' }
        });
        userPrompt.value = this.paperUserPrompt;
        userPrompt.addEventListener('input', () => {
            this.paperUserPrompt = userPrompt.value;
        });

        const useDefaultUser = userPromptContainer.createEl('button', {
            cls: 'use-default-btn',
            type: 'button',
            attr: { style: 'position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 0.85em;' }
        });
        useDefaultUser.textContent = 'Use Default ↺';
        useDefaultUser.addEventListener('click', () => {
            userPrompt.value = this.settings.paperUserPrompt;
            this.paperUserPrompt = this.settings.paperUserPrompt;
        });

        // Generate button
        const generateButton = form.createEl('button', {
            cls: 'ljoves-tools-button',
            type: 'button'
        });
        generateButton.textContent = 'Generate Summary & Create Note';

        generateButton.addEventListener('click', async () => {
            const selectedModel = modelSelect.value;
            await this.generatePaperSummary(selectedModel);
        });
    }

    private async generatePaperSummary(modelId: string) {
        if (!this.paperAnalysis) return;

        // Show generating screen
        this.renderGeneratingScreen();

        try {
            const apiKey = this.aiService.getCurrentApiKey();
            const provider = this.aiService.getModelProvider();

            // AlphaXiv integration variables
            let alphaxivArticle: string | undefined;
            let alphaxivUrl: string | undefined;
            let podcastFile: TFile | undefined;
            let transcriptText: string | undefined;

            // Fetch AlphaXiv content if enabled
            if (this.enableAlphaXiv) {
                this.renderLoadingScreen('⏳ AI is analyzing...\n⏳ Fetching AlphaXiv content...');

                const paperId = this.alphaXivService.extractPaperId(this.paperAnalysis.metadata.paperId);

                if (paperId) {
                    const { overview, resources } = this.alphaXivService.buildUrls(paperId);
                    alphaxivUrl = overview;

                    // Fetch article from overview page
                    const articleResult = await this.alphaXivService.fetchArticle(paperId);
                    if (articleResult.found && articleResult.html) {
                        // Use raw HTML for proper rendering of formulas (KaTeX) and images
                        alphaxivArticle = articleResult.html;
                        console.log(`[AlphaXiv] Article fetched, length: ${alphaxivArticle.length} chars`);
                    }

                    // Fetch resources (podcast and transcript)
                    const resourcesResult = await this.alphaXivService.fetchResources(paperId);
                    if (resourcesResult.found) {
                        // Download podcast if available
                        if (resourcesResult.podcastUrl) {
                            this.renderLoadingScreen('⏳ AI is analyzing...\n⏳ Fetching AlphaXiv content...\n⏳ Downloading podcast...');
                            const podcastPath = normalizePath(`${this.settings.paperPDFFolder}/${paperId}-podcast.mp3`);

                            // Check if podcast already exists
                            const existingPodcast = this.app.vault.getAbstractFileByPath(podcastPath);
                            if (existingPodcast instanceof TFile) {
                                podcastFile = existingPodcast;
                                console.log(`[AlphaXiv] Podcast already exists: ${podcastPath}`);
                            } else {
                                try {
                                    const response = await require('obsidian').requestUrl({
                                        url: resourcesResult.podcastUrl,
                                        method: 'GET'
                                    });

                                    if (response.status === 200 && response.arrayBuffer) {
                                        // Ensure folder exists
                                        const folderPath = normalizePath(this.settings.paperPDFFolder);
                                        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                                            await this.app.vault.createFolder(folderPath);
                                        }

                                        podcastFile = await this.app.vault.createBinary(podcastPath, response.arrayBuffer);
                                        console.log(`[AlphaXiv] Podcast downloaded: ${podcastPath}`);
                                    }
                                } catch (podcastError) {
                                    console.error('[AlphaXiv] Failed to download podcast:', podcastError);
                                }
                            }
                        }

                        // Store transcript if available
                        if (resourcesResult.transcript) {
                            transcriptText = resourcesResult.transcript;
                            console.log(`[AlphaXiv] Transcript found, length: ${transcriptText.length} chars`);
                        }
                    }
                }
            }

            // Now generate AI summary
            this.renderLoadingScreen('⏳ AI is analyzing the paper...');

            // Build full prompt - shorter for advanced mode
            const userPrompt = this.enableAlphaXiv
                ? `Provide a concise summary (2-3 paragraphs) of this research paper. Focus on the main contribution and key findings.\n\nPaper Text:\n${this.paperAnalysis.textContent.slice(0, 30000)}`
                : this.paperUserPrompt;

            const fullPrompt = `${this.paperSystemPrompt}

${userPrompt}`;

            // Generate summary (streaming)
            const summary = await this.aiService.streamAI(
                fullPrompt,
                provider,
                apiKey,
                (chunk) => {
                    // Update streaming display
                    this.updateGeneratingScreen(chunk);
                }
            );

            // Create note (advanced or regular)
            let noteFile: TFile;
            if (this.enableAlphaXiv) {
                noteFile = await this.paperImporterManager!.createAdvancedPaperNote(
                    this.paperAnalysis.metadata,
                    summary,
                    this.paperAnalysis.pdfFile,
                    this.settings.paperNotesFolder,
                    {
                        alphaxivUrl,
                        alphaxivArticle,
                        podcastFile,
                        transcriptText
                    }
                );
            } else {
                noteFile = await this.paperImporterManager!.createPaperNote(
                    this.paperAnalysis.metadata,
                    summary,
                    this.paperAnalysis.pdfFile,
                    this.settings.paperNotesFolder
                );
            }

            // Show success screen
            this.renderSuccessScreen(noteFile, summary);

        } catch (error) {
            console.error('Error generating summary:', error);
            new Notice(`Failed to generate summary: ${error.message}`);
            this.render();
        }
    }

    private renderGeneratingScreen() {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        const header = this.containerEl.createEl('div', { cls: 'ljoves-tools-header' });
        header.textContent = 'Generating Summary...';

        const statusEl = this.containerEl.createEl('div', {
            attr: { style: 'padding: 20px; text-align: center; color: var(--text-muted);' }
        });
        statusEl.textContent = '⏳ AI is analyzing the paper...';

        const responseContainer = this.containerEl.createEl('div', {
            cls: 'streaming-response',
            attr: { style: 'margin: 20px; padding: 16px; background: var(--background-secondary); border-radius: 8px; max-height: 400px; overflow-y: auto;' }
        });
        responseContainer.textContent = 'Waiting for response...';

        // Store reference for updates
        (this.containerEl as any)._responseContainer = responseContainer;
    }

    private updateGeneratingScreen(chunk: string) {
        const responseContainer = (this.containerEl as any)._responseContainer;
        if (responseContainer) {
            if (responseContainer.textContent === 'Waiting for response...') {
                responseContainer.textContent = '';
            }
            responseContainer.textContent += chunk;
            responseContainer.scrollTop = responseContainer.scrollHeight;
        }
    }

    private renderSuccessScreen(noteFile: TFile, summary: string) {
        this.containerEl.empty();
        this.containerEl.className = '';
        this.containerEl.addClass('ljoves-tools-container');

        const header = this.containerEl.createEl('div', {
            cls: 'ljoves-tools-header',
            attr: { style: 'color: var(--text-success);' }
        });
        header.textContent = '✅ Paper Imported Successfully!';

        const info = this.containerEl.createEl('div', { attr: { style: 'margin: 20px 0; padding: 16px; background: var(--background-secondary); border-radius: 8px;' } });

        const titleEl = info.createEl('div', { attr: { style: 'font-weight: 600; margin-bottom: 8px;' } });
        titleEl.textContent = `📄 ${this.paperAnalysis!.metadata.title}`;

        const locationEl = info.createEl('div', { attr: { style: 'color: var(--text-muted); margin-bottom: 4px;' } });
        locationEl.textContent = `📁 ${noteFile.path}`;

        const pdfEl = info.createEl('div', { attr: { style: 'color: var(--text-muted);' } });
        pdfEl.textContent = `📎 ${this.paperAnalysis!.pdfFile.path}`;

        const tokenEl = info.createEl('div', { attr: { style: 'color: var(--text-muted); margin-top: 8px;' } });
        const summaryTokens = this.paperImporterManager!.estimateTokens(summary);
        tokenEl.textContent = `Summary generated (~${summaryTokens.toLocaleString()} tokens)`;

        // Actions
        const actions = this.containerEl.createEl('div', { cls: 'ljoves-tools-results-actions' });

        const openButton = actions.createEl('button', { cls: 'ljoves-tools-button' });
        openButton.textContent = 'Open Note';
        openButton.addEventListener('click', async () => {
            await this.app.workspace.openLinkText(noteFile.basename, noteFile.path);
            this.paperAnalysis = null;
            this.selectedCategory = null;
            this.render();
        });

        const copyButton = actions.createEl('button', { cls: 'ljoves-tools-button' });
        copyButton.textContent = 'Copy Summary';
        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(summary);
            new Notice('Summary copied to clipboard');
        });

        const doneButton = actions.createEl('button', { cls: 'ljoves-tools-back-button' });
        doneButton.textContent = 'Done';
        doneButton.addEventListener('click', () => {
            this.paperAnalysis = null;
            this.selectedCategory = null;
            this.render();
        });
    }

    // ============================================
    // SHARED HELPER METHODS
    // ============================================

    private setupNoteSuggestions() {
        if (!this.noteInput) return;

        this.noteInput.addEventListener('keyup', e => {
            if (e.key === '[' && this.noteInput!.value.endsWith('[[')) {
                new NoteSuggester(this.app, this.noteInput!).open();
            }
        });
    }

    private async transcribeAudio(blob: Blob): Promise<string> {
        const openaiKey = this.settings.openaiApiKey.trim();
        if (!openaiKey) {
            new Notice('🔒 Please configure your OpenAI API key in plugin settings to use voice transcription.');
            throw new Error('OpenAI API key missing');
        }

        const form = new FormData();
        form.append('file', blob, 'recap.webm');
        form.append('model', 'gpt-4o-transcribe');

        try {
            const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${openaiKey}` },
                body: form
            });

            if (!res.ok) {
                if (res.status === 401) {
                    new Notice('❌ OpenAI transcription failed: invalid API key (401). Please check your key in Settings.');
                } else {
                    new Notice(`❌ Transcription error ${res.status}.`);
                }
                throw new Error(`Transcription failed ${res.status}`);
            }

            const json = await res.json();
            return json.text.trim();

        } catch (err) {
            console.error('transcribeAudio error:', err);
            throw err;
        }
    }

    private async streamExplanation(
        prompt: string,
        provider: string,
        apiKey: string,
        responseContainer: HTMLElement,
        latexRenderer: LatexRenderer
    ): Promise<string> {
        const url = provider === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.deepseek.com/v1/chat/completions';

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: this.settings.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                stream: true
            })
        });

        if (!res.ok) {
            throw new Error(`API Error ${res.status}`);
        }

        responseContainer.empty();
        const streamContainer = responseContainer.createEl('div', { cls: 'streaming-response' });

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                streamContainer.innerHTML = MarkdownRenderer.renderMarkdown(fullResponse);
                                streamContainer.scrollTop = streamContainer.scrollHeight;
                            }
                        } catch (e) {
                            // Skip malformed JSON chunks
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Final render with LaTeX support
        streamContainer.empty();
        await latexRenderer.renderLatexWithMarkdown(streamContainer, fullResponse, MarkdownRenderer.renderMarkdown);
        return fullResponse;
    }
}

class AddModelModal extends Modal {
    private onSubmit: (modelId: string, modelName: string) => void;
    private modelId = '';
    private modelName = '';

    constructor(app: App, onSubmit: (modelId: string, modelName: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: 'Add Custom Model' });

        // Model ID input
        new Setting(contentEl)
            .setName('Model ID')
            .setDesc('The exact model identifier from your provider (e.g., "gpt-4o", "gemini-2.0-flash-exp")')
            .addText(text => text
                .setPlaceholder('Enter model ID')
                .onChange(value => {
                    this.modelId = value;
                }));

        // Model Name input
        new Setting(contentEl)
            .setName('Display Name')
            .setDesc('A friendly name for this model (e.g., "GPT-4o", "Gemini Flash Experimental")')
            .addText(text => text
                .setPlaceholder('Enter display name')
                .onChange(value => {
                    this.modelName = value;
                }));

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        const submitButton = buttonContainer.createEl('button', { text: 'Add Model', cls: 'mod-cta' });
        submitButton.addEventListener('click', () => {
            if (this.modelId && this.modelName) {
                this.onSubmit(this.modelId.trim(), this.modelName.trim());
                this.close();
            } else {
                new Notice('Please fill in both Model ID and Display Name');
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class LjoveSToolsSettingTab extends PluginSettingTab {
    plugin: LjoveSToolsPlugin;

    constructor(app: App, plugin: LjoveSToolsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private getCurrentApiKey(): string {
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === this.plugin.settings.model);
        const provider = selectedModel?.provider || 'gemini';
        
        switch (provider) {
            case 'openai':
                return this.plugin.settings.openaiApiKey;
            case 'deepseek':
                return this.plugin.settings.deepseekApiKey;
            default:
                return this.plugin.settings.geminiApiKey;
        }
    }

    private maskApiKey(key: string): string {
        if (!key) return '';
        return '•'.repeat(Math.min(key.length, 32));
    }

    private createProviderSection(
        containerEl: HTMLElement,
        provider: typeof PROVIDERS[0],
        apiKeyUrl: string
    ): void {
        const providerContainer = containerEl.createDiv({ cls: 'study-provider-section' });

        // Provider header (collapsible)
        const headerEl = providerContainer.createDiv({ cls: 'study-provider-header' });
        headerEl.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: var(--background-secondary);
            border-radius: 6px;
            cursor: pointer;
            margin-bottom: 8px;
        `;

        const apiKey = this.plugin.settings[provider.apiKeyField as keyof LjoveSToolsSettings] as string;
        const hasKey = apiKey && apiKey.length > 0;

        const titleEl = headerEl.createDiv();
        titleEl.innerHTML = `<strong>${provider.name}</strong> ${hasKey ? '✅' : '⚠️'}`;

        const toggleEl = headerEl.createSpan({ text: '▼' });

        // Content area (collapsible)
        const contentEl = providerContainer.createDiv({ cls: 'study-provider-content' });
        contentEl.style.display = 'none';

        // Toggle collapse/expand
        let isExpanded = false;
        headerEl.addEventListener('click', () => {
            isExpanded = !isExpanded;
            contentEl.style.display = isExpanded ? 'block' : 'none';
            toggleEl.textContent = isExpanded ? '▲' : '▼';
        });

        // API Key setting with masked display
        new Setting(contentEl)
            .setName('API Key')
            .setDesc(`Get your API key at ${apiKeyUrl}`)
            .addText(text => {
                text.inputEl.type = 'password';
                text.inputEl.style.fontFamily = 'monospace';
                text.setPlaceholder('Enter API key')
                    .setValue(apiKey)
                    .onChange(async (value) => {
                        (this.plugin.settings as any)[provider.apiKeyField] = value;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to update status
                    });
            });

        // Custom models section
        const modelsHeader = contentEl.createEl('h4', { text: 'Custom Models' });
        modelsHeader.style.marginTop = '16px';
        modelsHeader.style.marginBottom = '8px';

        const customModels = this.plugin.settings.customModels.filter(m => m.provider === provider.id);

        if (customModels.length > 0) {
            customModels.forEach(model => {
                new Setting(contentEl)
                    .setName(model.name)
                    .setDesc(`Model ID: ${model.id}`)
                    .addButton(button => button
                        .setButtonText('Delete')
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.settings.customModels = this.plugin.settings.customModels.filter(m => m.id !== model.id);
                            await this.plugin.saveSettings();
                            this.display(); // Refresh
                        }));
            });
        }

        // Add new model button
        new Setting(contentEl)
            .setName('Add Custom Model')
            .setDesc('Add a new model for this provider')
            .addButton(button => button
                .setButtonText('+ Add Model')
                .onClick(() => {
                    this.showAddModelDialog(provider.id);
                }));
    }

    private showAddModelDialog(providerId: string): void {
        const modal = new AddModelModal(this.app, async (modelId: string, modelName: string) => {
            // Add the custom model
            this.plugin.settings.customModels.push({
                id: modelId,
                name: modelName,
                provider: providerId
            });
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings
        });
        modal.open();
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        console.log('LjoveS Tools Settings: New UI version loaded!');
        console.log('Custom models available:', this.plugin.settings.customModels);

        containerEl.createEl('h2', { text: 'LjoveS Tools Settings' });

        // Info banner
        const apiInfoEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        apiInfoEl.innerHTML = '💡 <strong>You only need ONE API key</strong> - choose your preferred provider below and configure it.';
        apiInfoEl.style.cssText = `
            margin-bottom: 16px;
            padding: 8px 12px;
            background-color: var(--background-secondary);
            border-radius: 4px;
        `;

        // Provider sections
        containerEl.createEl('h3', { text: 'API Configuration' });

        this.createProviderSection(containerEl, PROVIDERS[0], 'https://aistudio.google.com/app/apikey');
        this.createProviderSection(containerEl, PROVIDERS[1], 'https://platform.openai.com/api-keys');
        this.createProviderSection(containerEl, PROVIDERS[2], 'https://platform.deepseek.com/api-keys');

        // Model Selection
        containerEl.createEl('h3', { text: 'Active Model', cls: 'setting-item-heading' });
        containerEl.style.marginTop = '24px';

        new Setting(containerEl)
            .setName('AI Model')
            .setDesc('Select which AI model to use for all features')
            .addDropdown(dropdown => {
                // Add built-in models grouped by provider
                PROVIDERS.forEach(provider => {
                    const providerModels = AVAILABLE_MODELS.filter(m => m.provider === provider.id);
                    if (providerModels.length > 0) {
                        dropdown.addOption('', `--- ${provider.name} ---`);
                        providerModels.forEach(model => {
                            dropdown.addOption(model.id, `  ${model.name}`);
                        });
                    }
                });

                // Add custom models grouped by provider
                const hasCustomModels = this.plugin.settings.customModels.length > 0;
                if (hasCustomModels) {
                    PROVIDERS.forEach(provider => {
                        const customModels = this.plugin.settings.customModels.filter(m => m.provider === provider.id);
                        if (customModels.length > 0) {
                            dropdown.addOption('', `--- ${provider.name} (Custom) ---`);
                            customModels.forEach(model => {
                                dropdown.addOption(model.id, `  ${model.name}`);
                            });
                        }
                    });
                }

                dropdown.setValue(this.plugin.settings.model);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to update status
                });
            });

        // API Key Status
        const allModels = [...AVAILABLE_MODELS, ...this.plugin.settings.customModels];
        const selectedModel = allModels.find(m => m.id === this.plugin.settings.model);
        const provider = selectedModel?.provider || 'gemini';
        const currentApiKey = this.getCurrentApiKey();

        if (currentApiKey) {
            const statusEl = containerEl.createEl('div', {
                cls: 'setting-item-description',
                text: `✅ ${provider.toUpperCase()} API key configured for selected model`
            });
            statusEl.style.cssText = 'color: var(--text-success); margin-top: 10px;';
        } else {
            const statusEl = containerEl.createEl('div', {
                cls: 'setting-item-description',
                text: `❌ ${provider.toUpperCase()} API key required for selected model`
            });
            statusEl.style.cssText = 'color: var(--text-error); margin-top: 10px;';
        }

        // Research section
        containerEl.createEl('h3', { text: 'Research' });

        new Setting(containerEl)
            .setName('Paper Notes Folder')
            .setDesc('Folder where literature notes will be created (e.g., "Research/Papers/Literature Notes")')
            .addText(text => text
                .setPlaceholder('Literature Notes')
                .setValue(this.plugin.settings.paperNotesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.paperNotesFolder = value || 'Literature Notes';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('PDF Storage Folder')
            .setDesc('Folder where downloaded PDFs will be stored')
            .addText(text => text
                .setPlaceholder('Assets')
                .setValue(this.plugin.settings.paperPDFFolder)
                .onChange(async (value) => {
                    this.plugin.settings.paperPDFFolder = value || 'Assets';
                    await this.plugin.saveSettings();
                }));

        // Usage information
        containerEl.createEl('h3', { text: 'Features' });

        const featureInfo = containerEl.createEl('div', { cls: 'setting-item-description' });
        featureInfo.innerHTML = `
            <ul>
                <li><strong>Multi-Provider Support</strong> - Use Gemini, OpenAI, or DeepSeek models</li>
                <li><strong>Custom Models</strong> - Add any model from your provider</li>
                <li><strong>Automatic Language Detection</strong> - Questions generated in the same language as your notes</li>
                <li><strong>LaTeX Math Rendering</strong> - Mathematical expressions rendered beautifully</li>
                <li><strong>Smart Note Suggestions</strong> - Auto-complete from your vault</li>
                <li><strong>Interactive Testing</strong> - Slide-based interface with immediate feedback</li>
                <li><strong>Paper Importer</strong> - Import arXiv papers with AI-powered summaries</li>
            </ul>
        `;
    }
} 