import { App, Notice, TFile } from 'obsidian';
import { ChatSession, ChatMessage, ImageAttachment, LjoveSToolsSettings, AVAILABLE_MODELS } from '../types';
import { ChatNoteSuggester } from '../components/NoteSuggester';
import { ImageProcessResult } from './ImageService';

export class ChatManager {
    private app: App;
    private settings: LjoveSToolsSettings;
    private containerEl: HTMLElement;
    
    // Chat state
    private currentChatSession: ChatSession | null = null;
    private chatSessions: ChatSession[] = [];
    private chatInput: HTMLTextAreaElement | null = null;
    private chatInputImages: ImageAttachment[] = [];
    private chatMessagesContainer: HTMLElement | null = null;
    private isStreamingChat = false;
    private chatMenuPanel: HTMLElement | null = null;
    private showingPanel: 'menu' | 'history' | null = null;
    private isRequestInFlight: boolean = false;
    private currentAbortController: AbortController | null = null;
    private cleanupChatEvents: (() => void) | null = null;
    private dragOverlay: HTMLElement | null = null;

    // Callbacks for AI services
    private onStreamAI: (prompt: string, provider: string, apiKey: string, onChunk: (chunk: string) => void, images?: ImageAttachment[], abortController?: AbortController) => Promise<string>;
    private onGetCurrentApiKey: () => string;
    private onGetModelProvider: () => string;
    private onSaveImageToVault: (imageData: ArrayBuffer, isScreenshot?: boolean) => Promise<TFile>;
    private onProcessDroppedImage: (file: File) => Promise<ImageProcessResult>;
    private onGetImageFromClipboard: () => Promise<ImageProcessResult | null>;
    private onHandleFileUrl: (url: string) => Promise<boolean>;
    private onRenderMarkdown: (text: string) => string;

    constructor(
        app: App, 
        settings: LjoveSToolsSettings,
        containerEl: HTMLElement,
        callbacks: {
            streamAI: (prompt: string, provider: string, apiKey: string, onChunk: (chunk: string) => void, images?: ImageAttachment[], abortController?: AbortController) => Promise<string>;
            getCurrentApiKey: () => string;
            getModelProvider: () => string;
            saveImageToVault: (imageData: ArrayBuffer, isScreenshot?: boolean) => Promise<TFile>;
            processDroppedImage: (file: File) => Promise<ImageProcessResult>;
            getImageFromClipboard: () => Promise<ImageProcessResult | null>;
            handleFileUrl: (url: string) => Promise<boolean>;
            renderMarkdown: (text: string) => string;
        },
        private onBackCallback?: () => void
    ) {
        this.app = app;
        this.settings = settings;
        this.containerEl = containerEl;
        
        // Bind callbacks
        this.onStreamAI = callbacks.streamAI;
        this.onGetCurrentApiKey = callbacks.getCurrentApiKey;
        this.onGetModelProvider = callbacks.getModelProvider;
        this.onSaveImageToVault = callbacks.saveImageToVault;
        this.onProcessDroppedImage = callbacks.processDroppedImage;
        this.onGetImageFromClipboard = callbacks.getImageFromClipboard;
        this.onHandleFileUrl = callbacks.handleFileUrl;
        this.onRenderMarkdown = callbacks.renderMarkdown;
    }

    public initializeChat() {
        if (!this.currentChatSession) {
            this.currentChatSession = {
                id: Date.now().toString(),
                name: 'chat (1)',
                messages: [],
                model: this.settings.model,
                instructionPrompt: '',
                timestamp: Date.now()
            };
            this.chatSessions = [this.currentChatSession];
        }
    }

    public createNewChatSession() {
        this.currentChatSession = {
            id: Date.now().toString(),
            name: `chat (${this.chatSessions.length + 1})`,
            messages: [],
            model: this.settings.model,
            instructionPrompt: '',
            timestamp: Date.now()
        };
        this.chatSessions.push(this.currentChatSession);
    }

    public renderChatInterface() {
        // Container is already empty and has CSS classes set by main.ts

        // Create toolbar
        this.renderChatToolbar();

        // Create messages container
        this.chatMessagesContainer = this.containerEl.createEl('div', { cls: 'chat-messages-container' });

        // Create model selector section (MOVED: now between messages and input)
        this.renderModelSelector();

        // Create input area
        this.renderChatInputArea();

        // Initialize chat if needed
        this.initializeChat();

        // Render existing messages
        this.renderChatMessages();

        // Setup input handlers
        this.setupChatInputHandlers();

        // Setup global events for drag/drop
        this.setupChatGlobalEvents();
    }

    private renderChatToolbar() {
        const toolbar = this.containerEl.createEl('div', { cls: 'chat-toolbar' });
        
        // Left section with back button and session
        const leftSection = toolbar.createEl('div', { cls: 'chat-toolbar-left' });
        
        // Back button
        if (this.onBackCallback) {
            const backBtn = leftSection.createEl('button', { cls: 'ljoves-tools-back-button' });
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                this.onBackCallback?.();
            });
        }
        
        // Session dropdown
        const sessionButton = leftSection.createEl('button', { cls: 'chat-session-button' });
        sessionButton.innerHTML = `${this.currentChatSession?.name || 'chat (1)'} <span class="dropdown-arrow">⌄</span>`;
        sessionButton.addEventListener('click', () => {
            this.showChatSessionsDropdown(sessionButton);
        });
        
        // Right section with menu, stop (removed model selector)
        const rightSection = toolbar.createEl('div', { cls: 'chat-toolbar-right' });
        
        // Menu toggle
        const menuButton = rightSection.createEl('button', { cls: 'chat-menu-button', text: '⋮' });
        menuButton.addEventListener('click', () => {
            this.toggleChatMenu();
        });
        
        // Stop button (initially hidden)
        const stopButton = rightSection.createEl('button', { 
            cls: 'chat-stop-button',
            text: 'Stop',
            attr: { style: 'display: none;' }
        });
        stopButton.addEventListener('click', () => {
            this.stopChatResponse();
        });
        
        // Store references for updates
        (toolbar as any).sessionButton = sessionButton;
        (toolbar as any).stopButton = stopButton;
        
        // Store toolbar reference
        (this.containerEl as any).chatToolbar = toolbar;
    }

    private renderModelSelector() {
        const modelSection = this.containerEl.createEl('div', { cls: 'chat-model-selector' });

        // Model dropdown button
        const modelButton = modelSection.createEl('button', { cls: 'chat-model-button' });

        // Get current model and display full name (check both built-in and custom)
        const currentModel = this.currentChatSession?.model || this.settings.model;
        const allModels = [...AVAILABLE_MODELS, ...this.settings.customModels];
        const modelObj = allModels.find(m => m.id === currentModel);
        const modelName = modelObj?.name || currentModel;
        modelButton.innerHTML = `Model: ${modelName} <span class="dropdown-arrow">▲</span>`;

        modelButton.addEventListener('click', () => {
            this.showModelSelectorDropdown(modelButton);
        });

        // Store reference for updates
        (this.containerEl as any).modelButton = modelButton;
    }

    private async renderChatMessages() {
        if (!this.chatMessagesContainer || !this.currentChatSession) return;
        
        this.chatMessagesContainer.empty();
        
        if (this.currentChatSession.messages.length === 0) {
            const emptyState = this.chatMessagesContainer.createEl('div', { cls: 'chat-empty-state' });
            emptyState.createEl('p', { text: 'Start a conversation! You can:' });
            emptyState.createEl('ul').innerHTML = `
                <li>Ask questions about your notes using [[note name]]</li>
                <li>Paste or drag images for analysis</li>
                <li>Use the menu (⋮) to set instructions</li>
            `;
        }
        
        for (const message of this.currentChatSession.messages) {
            await this.renderChatMessage(message);
        }
        
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }

    private async renderChatMessage(message: ChatMessage) {
        if (!this.chatMessagesContainer) return;

        const messageEl = this.chatMessagesContainer.createEl('div', {
            cls: `chat-message chat-message-${message.role}`
        });
        messageEl.setAttribute('data-message-id', message.id);

        // Icon (avatar)
        const iconEl = messageEl.createEl('div', { cls: 'chat-message-icon' });
        iconEl.textContent = message.role === 'user' ? '👤' : '🤖';

        // Wrapper for content and footer
        const wrapperEl = messageEl.createEl('div', { cls: 'chat-message-wrapper' });

        // Content
        const contentEl = wrapperEl.createEl('div', { cls: 'chat-message-content' });

        // Render images if present
        if (message.images && message.images.length > 0) {
            const imagesEl = contentEl.createEl('div', { cls: 'chat-message-images' });
            for (const image of message.images) {
                const imgContainer = imagesEl.createEl('div', { cls: 'chat-image-container' });
                const imgEl = imgContainer.createEl('img', {
                    cls: 'chat-image',
                    attr: { src: image.data, alt: 'Attached image' }
                });

                // Add image metadata
                const metaEl = imgContainer.createEl('div', { cls: 'chat-image-meta' });
                metaEl.textContent = image.filename;
            }
        }

        // Render text content
        if (message.content) {
            const textEl = contentEl.createEl('div', { cls: 'chat-message-text' });
            if (message.role === 'assistant') {
                textEl.innerHTML = this.onRenderMarkdown(message.content);
            } else {
                textEl.textContent = message.content;
            }
        }

        // Footer with timestamp and copy button
        const footerEl = wrapperEl.createEl('div', { cls: 'chat-message-footer' });

        const timestampEl = footerEl.createEl('span', { cls: 'chat-message-timestamp' });
        timestampEl.textContent = new Date(message.timestamp).toLocaleString();

        const copyBtn = footerEl.createEl('button', { cls: 'chat-message-copy-btn' });
        copyBtn.innerHTML = '📋';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(message.content);
            new Notice('Message copied to clipboard');
        });

        // Add streaming indicator for typing messages
        if (message.id === 'typing') {
            const typingEl = contentEl.createEl('div', { cls: 'typing-indicator' });
            typingEl.innerHTML = '<span></span><span></span><span></span>';
        }
    }

    private renderChatInputArea() {
        const inputArea = this.containerEl.createEl('div', { cls: 'chat-input-area' });
        
        // Image preview area
        const imagePreview = inputArea.createEl('div', { cls: 'chat-input-images' });
        (inputArea as any).imagePreview = imagePreview;
        
        // Input wrapper
        const inputWrapper = inputArea.createEl('div', { cls: 'chat-input-wrapper' });
        
        // Text input
        this.chatInput = inputWrapper.createEl('textarea', { 
            cls: 'chat-input',
            attr: { 
                placeholder: 'Message LjoveS Tools... (Use [[note name]] to reference notes)',
                rows: '1'
            }
        });
        
        // Send button
        const sendButton = inputWrapper.createEl('button', { 
            cls: 'chat-send-button',
            text: 'Send'
        });
        sendButton.addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        // Store references
        (inputArea as any).sendButton = sendButton;
        (this.containerEl as any).chatInputArea = inputArea;
        
        this.updateImagePreview();
    }

    private setupChatInputHandlers() {
        if (!this.chatInput) return;
        
        // Auto-resize
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });
        
        this.chatInput.addEventListener('input', () => {
            if (this.chatInput) {
                this.chatInput.style.height = 'auto';
                this.chatInput.style.height = Math.min(200, this.chatInput.scrollHeight) + 'px';
            }
        });
        
        // Note suggestions
        this.chatInput.addEventListener('keyup', (e) => {
            if (e.key === '[' && this.chatInput!.value.endsWith('[[')) {
                new ChatNoteSuggester(this.app, this.chatInput!).open();
            }
        });
        
        // Image paste
        this.chatInput.addEventListener('paste', (e) => {
            this.handleImagePaste(e);
        });
    }

    private async sendChatMessage() {
        if (!this.chatInput || !this.currentChatSession) return;
        
        const content = this.chatInput.value.trim();
        if (!content && this.chatInputImages.length === 0) {
            return;
        }
        
        // Check if we have images and the current model doesn't support them
        const provider = this.onGetModelProvider();
        const apiKey = this.onGetCurrentApiKey();
        
        if (!apiKey) {
            new Notice(`Please set your ${provider.toUpperCase()} API key in settings first.`);
            return;
        }
        
        if (this.chatInputImages.length > 0 && provider !== 'gemini') {
            await this.showImageModelValidationDialog();
            return;
        }
        
        this.chatInput.disabled = true;
        this.updateChatControls();
        
        try {
            // Create user message
            const rawInput = this.buildRawInput(content, this.chatInputImages);
            
            const userMessage: ChatMessage = {
                id: Date.now().toString(),
                role: 'user',
                content: content,
                rawInput: rawInput,
                taggedNotes: this.extractTaggedNotes(content),
                timestamp: Date.now(),
                images: [...this.chatInputImages],
            };
            
            this.currentChatSession.messages.push(userMessage);
            
            // Clear input
            this.chatInput.value = '';
            this.chatInputImages = [];
            this.updateImagePreview();
            
            // Re-render messages to show user message
            await this.renderChatMessages();
            
            // Generate AI response
            await this.generateChatResponse(userMessage);
            
        } catch (error) {
            console.error('Error sending chat message:', error);
            new Notice('Failed to send message');
        } finally {
            this.chatInput.disabled = false;
            this.updateChatControls();
            this.chatInput.focus();
        }
    }

    private buildRawInput(content: string, images: ImageAttachment[]): string {
        let raw = content;
        if (images.length > 0) {
            raw += '\n\n[Images attached: ' + images.map(img => img.filename).join(', ') + ']';
        }
        return raw;
    }

    private extractTaggedNotes(content: string): string[] {
        const noteRegex = /\[\[([^\]]+)\]\]/g;
        const matches = [];
        let match;
        while ((match = noteRegex.exec(content)) !== null) {
            matches.push(match[1]);
        }
        return matches;
    }

    private async generateChatResponse(userMessage: ChatMessage) {
        if (!this.currentChatSession) return;
        
        const provider = this.onGetModelProvider();
        const apiKey = this.onGetCurrentApiKey();
        
        // Resolve tagged notes
        const noteContents = await this.resolveTaggedNotes(userMessage.taggedNotes || []);
        
        // Build chat context
        const context = this.buildChatContext(userMessage, noteContents);
        
        // Remove any existing typing indicator
        this.currentChatSession.messages = this.currentChatSession.messages.filter(m => m.id !== 'typing');

        // Add typing indicator
        const typingMessage: ChatMessage = {
            id: 'typing',
            role: 'assistant',
            content: '',
            timestamp: Date.now()
        };

        this.currentChatSession.messages.push(typingMessage);
        await this.renderChatMessages();

        // Create abort controller for this request
        this.currentAbortController = new AbortController();
        this.isRequestInFlight = true;
        this.isStreamingChat = true;
        this.updateChatControls();

        // Create assistant message for streaming (but don't add to messages yet)
        const assistantMessage: ChatMessage = {
            id: Date.now().toString() + '_assistant',
            role: 'assistant',
            content: '',
            timestamp: Date.now()
        };

        let isFirstChunk = true;

        try {
            console.log(`[Chat] Starting streaming with ${provider}...`);

            const fullResponse = await this.onStreamAI(context, provider, apiKey, (chunk: string) => {
                console.log(`[Chat] Received chunk (${chunk.length} chars):`, chunk.substring(0, 50));

                // On first chunk, remove typing indicator and add assistant message
                if (isFirstChunk) {
                    isFirstChunk = false;
                    this.currentChatSession!.messages = this.currentChatSession!.messages.filter(m => m.id !== 'typing');
                    this.currentChatSession!.messages.push(assistantMessage);
                }

                // Update the message content with each chunk
                assistantMessage.content += chunk;
                this.updateStreamingMessage(assistantMessage);
            }, userMessage.images, this.currentAbortController);

            console.log(`[Chat] Streaming completed. Total length: ${fullResponse?.length || 0}`);

            // If streaming didn't produce chunks but returned a response, use it
            if (isFirstChunk && fullResponse) {
                this.currentChatSession.messages = this.currentChatSession.messages.filter(m => m.id !== 'typing');
                assistantMessage.content = fullResponse;
                this.currentChatSession.messages.push(assistantMessage);
            } else if (!isFirstChunk) {
                // Ensure content is the full response
                assistantMessage.content = fullResponse || assistantMessage.content;
            }
            
        } catch (error) {
            console.error('Error generating chat response:', error);
            
            // Remove the assistant message if it failed
            this.currentChatSession.messages = this.currentChatSession.messages.filter(m => m.id !== assistantMessage.id);
            
            // Add error message
            const errorMessage: ChatMessage = {
                id: Date.now().toString() + '_error',
                role: 'assistant',
                content: 'Sorry, I encountered an error processing your message. Please try again.',
                timestamp: Date.now()
            };
            this.currentChatSession.messages.push(errorMessage);
            
        } finally {
            // Clean up
            this.currentChatSession.messages = this.currentChatSession.messages.filter(m => m.id !== 'typing');
            this.isRequestInFlight = false;
            this.isStreamingChat = false;
            this.currentAbortController = null;
            this.updateChatControls();
            await this.renderChatMessages();
        }
    }

    private updateChatControls() {
        const toolbar = (this.containerEl as any).chatToolbar;
        const inputArea = (this.containerEl as any).chatInputArea;
        
        if (this.chatInput) {
            this.chatInput.disabled = this.isStreamingChat;
        }
        
        if (inputArea?.sendButton) {
            inputArea.sendButton.disabled = this.isStreamingChat;
        }
        
        this.updateStopButton();
    }

    private updateStopButton() {
        const toolbar = (this.containerEl as any).chatToolbar;
        if (toolbar?.stopButton) {
            toolbar.stopButton.style.display = this.isStreamingChat ? 'inline-block' : 'none';
        }
    }

    private stopChatResponse() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            this.isRequestInFlight = false;
            this.isStreamingChat = false;
            this.updateChatControls();
        }
    }

    private updateStreamingMessage(message: ChatMessage) {
        const messageEl = this.chatMessagesContainer?.querySelector(`[data-message-id="${message.id}"]`);
        if (messageEl) {
            const contentEl = messageEl.querySelector('.chat-message-text');
            if (contentEl) {
                contentEl.innerHTML = this.onRenderMarkdown(message.content);
            }
            
            // Auto-scroll to bottom during streaming
            if (this.chatMessagesContainer) {
                this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
            }
        }
    }

    private async showImageModelValidationDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        modalContent.innerHTML = `
            <h3>Image Support Required</h3>
            <p>The current model doesn't support image analysis. Please switch to a Gemini model to use images in chat.</p>
            <div class="modal-buttons">
                <button class="modal-button-primary" id="switch-model">Switch to Gemini</button>
                <button class="modal-button-secondary" id="remove-images">Remove Images</button>
                <button class="modal-button-secondary" id="cancel">Cancel</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        return new Promise<void>((resolve) => {
            const cleanup = () => {
                document.body.removeChild(modal);
                resolve();
            };
            
            modal.querySelector('#switch-model')?.addEventListener('click', () => {
                // Find first Gemini model
                const geminiModel = AVAILABLE_MODELS.find(model => 
                    model.provider === 'gemini'
                )?.id;
                if (geminiModel) {
                    this.switchChatModel(geminiModel);
                }
                cleanup();
            });
            
            modal.querySelector('#remove-images')?.addEventListener('click', () => {
                this.chatInputImages = [];
                this.updateImagePreview();
                cleanup();
            });
            
            modal.querySelector('#cancel')?.addEventListener('click', cleanup);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) cleanup();
            });
        });
    }

    private async resolveTaggedNotes(noteNames: string[]): Promise<Array<{name: string, content: string}>> {
        const results = [];

        for (const noteName of noteNames) {
            // Search for file by basename (supports notes in any folder)
            const files = this.app.vault.getMarkdownFiles();
            const file = files.find(f => {
                const basename = f.basename;
                const nameWithoutExt = f.name.replace('.md', '');
                return basename === noteName || nameWithoutExt === noteName || f.path === noteName;
            });

            if (file) {
                try {
                    const content = await this.app.vault.read(file);
                    results.push({ name: noteName, content });
                    console.log(`✓ Loaded note: ${noteName} (${file.path})`);
                } catch (error) {
                    console.error(`Failed to read note ${noteName}:`, error);
                }
            } else {
                console.warn(`Note not found: ${noteName}`);
            }
        }

        return results;
    }

    private buildChatContext(userMessage: ChatMessage, noteContents: Array<{name: string, content: string}>): string {
        let context = '';
        
        // Add system instructions if present
        if (this.currentChatSession?.instructionPrompt) {
            context += `Instructions: ${this.currentChatSession.instructionPrompt}\n\n`;
        }
        
        // Add note contents
        if (noteContents.length > 0) {
            context += 'Referenced notes:\n\n';
            for (const note of noteContents) {
                context += `## ${note.name}\n${note.content}\n\n`;
            }
        }
        
        // Add conversation history (last 10 messages to avoid context overflow)
        context += 'Conversation history:\n\n';
        if (this.currentChatSession) {
            const recentMessages = this.currentChatSession.messages
                .filter(m => m.id !== 'typing' && m.role !== 'system')
                .slice(-10);
            
            for (const message of recentMessages) {
                if (message.role === 'user') {
                    context += `User: ${message.content}\n`;
                } else if (message.role === 'assistant') {
                    context += `Assistant: ${message.content}\n`;
                }
            }
        }
        
        context += `\nCurrent user message: ${userMessage.content}`;
        
        return context;
    }

    private async handleImagePaste(e: ClipboardEvent) {
        const clipboardImage = await this.onGetImageFromClipboard();
        if (clipboardImage) {
            e.preventDefault();
            await this.addClipboardImageToChat(clipboardImage);
        }
    }

    private async addClipboardImageToChat(clipboardImage: ImageProcessResult) {
        try {
            // Save to vault first to get proper file reference
            const file = await this.onSaveImageToVault(clipboardImage.data, clipboardImage.isScreenshot);
            
            // Convert to base64 for display
            const blob = new Blob([clipboardImage.data], { type: clipboardImage.type });
            const base64 = await this.blobToBase64(blob);
            
            const imageAttachment: ImageAttachment = {
                id: Date.now().toString(),
                name: file.name,
                data: base64,
                size: clipboardImage.data.byteLength,
                mimeType: clipboardImage.type,
                vaultFile: file,
                filename: file.name,
                vaultPath: file.path
            };
            
            this.chatInputImages.push(imageAttachment);
            this.updateImagePreview();
            
        } catch (error) {
            console.error('Error processing clipboard image:', error);
            new Notice('Failed to process clipboard image');
        }
    }

    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private async addImageToChat(file: File) {
        try {
            const imageData = await this.onProcessDroppedImage(file);
            const vaultFile = await this.onSaveImageToVault(imageData.data, imageData.isScreenshot);
            
            // Convert to base64 for display
            const base64 = await this.fileToBase64(file);
            
            const imageAttachment: ImageAttachment = {
                id: Date.now().toString(),
                name: vaultFile.name,
                data: base64,
                size: file.size,
                mimeType: imageData.type,
                vaultFile: vaultFile,
                filename: vaultFile.name,
                vaultPath: vaultFile.path
            };
            
            this.chatInputImages.push(imageAttachment);
            this.updateImagePreview();
            
        } catch (error) {
            console.error('Error processing dropped image:', error);
            new Notice('Failed to process image');
        }
    }

    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    private updateImagePreview() {
        const inputArea = (this.containerEl as any).chatInputArea;
        const imagePreview = inputArea?.imagePreview;
        if (!imagePreview) return;
        
        imagePreview.empty();
        
        if (this.chatInputImages.length === 0) {
            imagePreview.style.display = 'none';
            return;
        }
        
        imagePreview.style.display = 'block';
        
        this.chatInputImages.forEach((image) => {
            const imageContainer = imagePreview.createEl('div', { cls: 'image-preview-item' });
            
            const img = imageContainer.createEl('img', {
                attr: { src: image.data, alt: 'Preview' },
                cls: 'image-preview'
            });
            
            const removeButton = imageContainer.createEl('button', {
                text: '×',
                cls: 'image-remove-button'
            });
            
            removeButton.addEventListener('click', () => {
                this.removeImageFromChat(image.id);
            });
            
            const filename = imageContainer.createEl('div', {
                text: image.filename,
                cls: 'image-filename'
            });
        });
    }

    private removeImageFromChat(imageId: string) {
        this.chatInputImages = this.chatInputImages.filter(img => img.id !== imageId);
        this.updateImagePreview();
    }

    private toggleChatMenu() {
        if (this.showingPanel === 'menu') {
            this.hideChatPanel();
        } else {
            this.showChatMenu();
        }
    }

    private showChatMenu() {
        this.hideChatPanel();
        this.showingPanel = 'menu';
        
        this.chatMenuPanel = this.containerEl.createEl('div', { cls: 'chat-panel chat-menu-panel' });
        
        const menuContent = this.chatMenuPanel.createEl('div', { cls: 'chat-panel-content' });
        menuContent.createEl('h3', { text: 'Chat Options' });
        
        // Instructions section
        const instructionsSection = menuContent.createEl('div', { cls: 'menu-section' });
        instructionsSection.createEl('label', { text: 'System Instructions:' });
        const instructionTextarea = instructionsSection.createEl('textarea', {
            cls: 'instruction-input',
            attr: { 
                placeholder: 'Add custom instructions for the AI assistant...',
                rows: '3'
            }
        });
        
        // Load existing instructions
        if (this.currentChatSession?.instructionPrompt) {
            instructionTextarea.value = this.currentChatSession.instructionPrompt;
        }
        
        // Save instructions on change
        instructionTextarea.addEventListener('input', () => {
            if (this.currentChatSession) {
                this.currentChatSession.instructionPrompt = instructionTextarea.value;
            }
        });
        
        // Actions section
        const actionsSection = menuContent.createEl('div', { cls: 'menu-section' });
        
        const clearButton = actionsSection.createEl('button', { text: 'Clear History', cls: 'menu-button' });
        clearButton.addEventListener('click', () => {
            this.clearChatHistory();
            this.hideChatPanel();
        });
        
        const downloadButton = actionsSection.createEl('button', { text: 'Download as Note', cls: 'menu-button' });
        downloadButton.addEventListener('click', () => {
            this.downloadChatAsNote();
            this.hideChatPanel();
        });
        
        const closeButton = menuContent.createEl('button', { text: 'Close', cls: 'panel-close-button' });
        closeButton.addEventListener('click', () => this.hideChatPanel());
    }

    private hideChatPanel() {
        if (this.chatMenuPanel) {
            this.chatMenuPanel.remove();
            this.chatMenuPanel = null;
        }
        this.showingPanel = null;
    }

    private updateModelDisplay() {
        const modelButton = (this.containerEl as any).modelButton;
        if (modelButton) {
            const currentModel = this.currentChatSession?.model || this.settings.model;
            const allModels = [...AVAILABLE_MODELS, ...this.settings.customModels];
            const modelObj = allModels.find(m => m.id === currentModel);
            const modelName = modelObj?.name || currentModel;
            modelButton.innerHTML = `Model: ${modelName} <span class="dropdown-arrow">▲</span>`;
        }
    }

    private clearChatHistory() {
        if (this.currentChatSession) {
            this.currentChatSession.messages = [];
            this.renderChatMessages();
        }
    }

    private async downloadChatAsNote() {
        if (!this.currentChatSession || this.currentChatSession.messages.length === 0) {
            new Notice('No chat history to download');
            return;
        }
        
        try {
            let markdown = `# ${this.currentChatSession.name}\n\n`;
            
            // Add instructions if present
            if (this.currentChatSession.instructionPrompt) {
                markdown += `## Instructions\n${this.currentChatSession.instructionPrompt}\n\n`;
            }
            
            markdown += `## Conversation\n\n`;
            
            this.currentChatSession.messages.forEach((message, index) => {
                if (message.role === 'user') {
                    markdown += `**You:** ${message.content}\n\n`;
                } else if (message.role === 'assistant') {
                    markdown += `**Assistant:** ${message.content}\n\n`;
                }
                
                if (index < this.currentChatSession!.messages.length - 1) {
                    markdown += '---\n\n';
                }
            });
            
            const fileName = `Chat - ${this.currentChatSession.name} - ${new Date().toISOString().split('T')[0]}.md`;
            
            await this.app.vault.create(fileName, markdown);
            new Notice(`Chat exported as "${fileName}"`);
            
        } catch (error) {
            console.error('Error downloading chat:', error);
            new Notice('Failed to export chat');
        }
    }

    private setupChatGlobalEvents() {
        const handlePaste = (e: ClipboardEvent) => {
            if (this.chatInput && document.activeElement === this.chatInput) {
                this.handleImagePaste(e);
            }
        };
        
        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            if (this.containerEl.contains(e.target as Node)) {
                this.handleDragDropImages(e);
            }
        };
        
        const handleDragOver = (e: DragEvent) => {
            if (this.containerEl.contains(e.target as Node)) {
                e.preventDefault();
                this.addDragOverlay();
            }
        };
        
        const handleDragLeave = (e: DragEvent) => {
            if (!this.containerEl.contains(e.relatedTarget as Node)) {
                this.removeDragOverlay();
            }
        };
        
        document.addEventListener('paste', handlePaste);
        document.addEventListener('drop', handleDrop);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('dragleave', handleDragLeave);
        
        this.cleanupChatEvents = () => {
            document.removeEventListener('paste', handlePaste);
            document.removeEventListener('drop', handleDrop);
            document.removeEventListener('dragover', handleDragOver);
            document.removeEventListener('dragleave', handleDragLeave);
        };
    }

    private addDragOverlay() {
        if (this.dragOverlay) return;
        
        this.dragOverlay = document.createElement('div');
        this.dragOverlay.className = 'drag-overlay';
        this.dragOverlay.innerHTML = `
            <div class="drag-overlay-content">
                <div class="drag-overlay-icon">📎</div>
                <div class="drag-overlay-text">Drop images here to add to chat</div>
            </div>
        `;
        
        this.containerEl.appendChild(this.dragOverlay);
    }

    private removeDragOverlay() {
        if (this.dragOverlay) {
            this.dragOverlay.remove();
            this.dragOverlay = null;
        }
    }

    private async handleDragDropImages(e: DragEvent) {
        this.removeDragOverlay();
        
        if (!e.dataTransfer) return;
        
        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        
        if (imageFiles.length === 0) {
            // Check for URLs
            const text = e.dataTransfer.getData('text/plain');
            if (text && text.startsWith('http')) {
                const handled = await this.onHandleFileUrl(text);
                if (!handled) {
                    new Notice('Could not process the dropped URL');
                }
            }
            return;
        }
        
        for (const file of imageFiles) {
            await this.addImageToChat(file);
        }
    }

    private showChatSessionsDropdown(buttonEl: HTMLElement) {
        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-menu';
        
        // Position dropdown
        const rect = buttonEl.getBoundingClientRect();
        dropdown.style.position = 'absolute';
        dropdown.style.top = (rect.bottom + 5) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.zIndex = '1000';
        
        // Add sessions
        this.chatSessions.forEach((session, index) => {
            const item = dropdown.createEl('div', { cls: 'dropdown-item' });
            item.innerHTML = `
                <span class="session-name">${session.name}</span>
                ${session.id === this.currentChatSession?.id ? '<span class="current-indicator">✓</span>' : ''}
            `;
            
            item.addEventListener('click', () => {
                this.switchChatSession(session);
                document.body.removeChild(dropdown);
            });
        });
        
        // Add new session option
        const newSessionItem = dropdown.createEl('div', { cls: 'dropdown-item new-session' });
        newSessionItem.innerHTML = '<span>+ New Chat</span>';
        newSessionItem.addEventListener('click', () => {
            this.createNewChatSession();
            this.renderChatInterface();
            document.body.removeChild(dropdown);
        });
        
        document.body.appendChild(dropdown);
        
        // Close on outside click
        const closeDropdown = (e: MouseEvent) => {
            if (!dropdown.contains(e.target as Node)) {
                document.body.removeChild(dropdown);
                document.removeEventListener('click', closeDropdown);
            }
        };
        
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    }

    private showModelSelectorDropdown(buttonEl: HTMLElement) {
        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-menu model-selector';

        // Get current model
        const currentModel = this.currentChatSession?.model || this.settings.model;

        // Merge built-in models with custom models
        const allModels = [...AVAILABLE_MODELS, ...this.settings.customModels];

        // Group models by provider
        const groupedModels: { [provider: string]: typeof AVAILABLE_MODELS } = {};

        for (const model of allModels) {
            const provider = model.provider;
            if (!groupedModels[provider]) {
                groupedModels[provider] = [];
            }
            groupedModels[provider].push(model);
        }

        // Render models grouped by provider
        for (const [provider, models] of Object.entries(groupedModels)) {
            // Add provider header
            const header = dropdown.createEl('div', { cls: 'dropdown-header' });
            header.textContent = provider.toUpperCase();

            // Add models for this provider
            for (const model of models) {
                const item = dropdown.createEl('div', { cls: 'dropdown-item' });
                item.innerHTML = `
                    <span class="model-name">${model.name}</span>
                    ${model.id === currentModel ? '<span class="current-indicator">✓</span>' : ''}
                `;

                item.addEventListener('click', () => {
                    this.switchChatModel(model.id);
                    if (dropdown.parentElement) {
                        document.body.removeChild(dropdown);
                    }
                });
            }
        }

        document.body.appendChild(dropdown);

        // Position dropdown UPWARD (above button)
        const rect = buttonEl.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.zIndex = '1000';
        dropdown.style.maxHeight = '400px';
        dropdown.style.overflowY = 'auto';

        // Calculate position - show above button
        const dropdownHeight = dropdown.offsetHeight;
        dropdown.style.bottom = (window.innerHeight - rect.top + 5) + 'px';

        // Close on outside click
        const closeDropdown = (e: MouseEvent) => {
            if (!dropdown.contains(e.target as Node) && dropdown.parentElement) {
                document.body.removeChild(dropdown);
                document.removeEventListener('click', closeDropdown);
            }
        };

        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    }

    private switchChatSession(session: ChatSession) {
        this.currentChatSession = session;
        this.renderChatMessages();
        this.updateModelDisplay();
    }

    private async switchChatModel(modelId: string) {
        // Update global settings
        this.settings.model = modelId;
        
        // Update current session model
        if (this.currentChatSession) {
            this.currentChatSession.model = modelId;
        }
        
        // Update display
        this.updateModelDisplay();
        
        new Notice(`Switched to ${modelId.replace(/^(gemini-|gpt-|deepseek-)/, '')}`);
    }

    public cleanup() {
        if (this.cleanupChatEvents) {
            this.cleanupChatEvents();
        }
        
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        
        this.removeDragOverlay();
        this.hideChatPanel();
    }

    // Getters for external access
    public getCurrentSession(): ChatSession | null {
        return this.currentChatSession;
    }

    public getSessions(): ChatSession[] {
        return this.chatSessions;
    }
}