import { App, Notice, requestUrl, TFile, normalizePath } from 'obsidian';
import { LjoveSToolsSettings } from '../types';

export interface PaperMetadata {
    paperId: string;
    title: string;
    authors: string[];
    date: string;
    abstract: string;
    comments: string;
    pdfUrl: string;
}

export interface PaperAnalysis {
    metadata: PaperMetadata;
    pdfFile: TFile;
    textContent: string;
    tokenCount: number;
}

export class PaperImporterManager {
    private app: App;
    private settings: LjoveSToolsSettings;
    private containerEl: HTMLElement;

    // Callbacks
    private onCallAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
    private onStreamAI: (
        prompt: string,
        provider: string,
        apiKey: string,
        onChunk: (chunk: string) => void,
        images?: any[],
        abortController?: AbortController
    ) => Promise<string>;
    private onGetCurrentApiKey: () => string;
    private onGetModelProvider: () => string;
    private onBackCallback?: () => void;

    constructor(
        app: App,
        settings: LjoveSToolsSettings,
        containerEl: HTMLElement,
        callbacks: {
            callAI: (prompt: string, provider: string, apiKey: string) => Promise<string | null>;
            streamAI: (
                prompt: string,
                provider: string,
                apiKey: string,
                onChunk: (chunk: string) => void,
                images?: any[],
                abortController?: AbortController
            ) => Promise<string>;
            getCurrentApiKey: () => string;
            getModelProvider: () => string;
        },
        onBackCallback?: () => void
    ) {
        this.app = app;
        this.settings = settings;
        this.containerEl = containerEl;

        // Bind callbacks
        this.onCallAI = callbacks.callAI;
        this.onStreamAI = callbacks.streamAI;
        this.onGetCurrentApiKey = callbacks.getCurrentApiKey;
        this.onGetModelProvider = callbacks.getModelProvider;
        this.onBackCallback = onBackCallback;
    }

    /**
     * Extract arXiv ID from URL or ID string
     */
    public extractArxivId(input: string): string | null {
        input = input.trim();

        // Direct ID: 1706.03762
        if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(input)) {
            return input.replace(/v\d+$/, ''); // Remove version
        }

        // URL: https://arxiv.org/abs/1706.03762
        const urlMatch = input.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?/i);
        if (urlMatch) {
            return urlMatch[1];
        }

        // arxiv:1706.03762
        const arxivMatch = input.match(/arxiv:(\d{4}\.\d{4,5})(v\d+)?/i);
        if (arxivMatch) {
            return arxivMatch[1];
        }

        // Old format: hep-th/9901001
        if (/^[a-z-]+\/\d{7}$/.test(input)) {
            return input;
        }

        return null;
    }

    /**
     * Fetch paper metadata from arXiv API
     */
    public async fetchPaperMetadata(arxivId: string): Promise<PaperMetadata> {
        const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;

        const response = await requestUrl({ url });
        const parser = new DOMParser();
        const xml = parser.parseFromString(response.text, 'text/xml');

        const entry = xml.querySelector('entry');
        if (!entry) {
            throw new Error('Paper not found on arXiv');
        }

        const title = entry.querySelector('title')?.textContent?.trim();
        if (!title || title === 'Error') {
            const message = entry.querySelector('summary')?.textContent?.trim() || 'Unknown error';
            throw new Error(message);
        }

        const authors = Array.from(entry.querySelectorAll('author')).map(author => {
            return author.querySelector('name')?.textContent?.trim() || 'Unknown author';
        });

        const date = entry.querySelector('published')?.textContent?.trim() || '';
        const abstract = entry.querySelector('summary')?.textContent?.trim() || 'No abstract available';
        const comments = entry.querySelector('comment')?.textContent?.trim() || '';
        const paperId = entry.querySelector('id')?.textContent?.split('abs/')?.pop()?.trim() || '';
        const pdfUrl = entry.querySelector('link[title="pdf"]')?.getAttribute('href')?.trim()?.replace(/^http:\/\//i, 'https://') || '';

        return {
            paperId,
            title,
            authors,
            date,
            abstract,
            comments,
            pdfUrl
        };
    }

    /**
     * Download PDF to vault
     */
    public async downloadPDF(pdfUrl: string, filename: string, folder: string): Promise<TFile> {
        // Sanitize filename
        const safeName = filename.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
        const pdfFilename = `${safeName}.pdf`;
        const pdfPath = normalizePath(`${folder}/${pdfFilename}`);

        // Check if file exists
        const existingFile = this.app.vault.getAbstractFileByPath(pdfPath);
        if (existingFile instanceof TFile) {
            return existingFile;
        }

        // Ensure folder exists
        const folderPath = normalizePath(folder);
        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
            await this.app.vault.createFolder(folderPath);
        }

        // Download PDF
        const response = await requestUrl({ url: pdfUrl, method: 'GET' });
        const arrayBuffer = response.arrayBuffer;

        // Save to vault
        const file = await this.app.vault.createBinary(pdfPath, arrayBuffer);
        return file;
    }

    /**
     * Extract text from PDF using PDF.js
     */
    /**
     * Load PDF.js library from CDN
     */
    private async loadPDFLib(): Promise<any> {
        // Check if already loaded
        if ((window as any).pdfjsLib) {
            return (window as any).pdfjsLib;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
            script.type = 'module';

            script.onload = () => {
                // Wait a bit for the global to be set
                const checkInterval = setInterval(() => {
                    if ((window as any).pdfjsLib) {
                        clearInterval(checkInterval);
                        const pdfjsLib = (window as any).pdfjsLib;
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
                        resolve(pdfjsLib);
                    }
                }, 50);

                // Timeout after 5 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    reject(new Error('PDF.js failed to load from CDN'));
                }, 5000);
            };

            script.onerror = () => reject(new Error('Failed to load PDF.js script'));
            document.head.appendChild(script);
        });
    }

    public async extractPDFText(file: TFile): Promise<string> {
        try {
            console.log('[PaperImporter] Starting PDF text extraction for:', file.path);

            // Load PDF.js from CDN
            console.log('[PaperImporter] Loading PDF.js library from CDN...');
            const pdfjsLib = await this.loadPDFLib();
            console.log('[PaperImporter] PDF.js loaded successfully');

            // Read PDF file
            console.log('[PaperImporter] Reading PDF file from vault...');
            const arrayBuffer = await this.app.vault.readBinary(file);
            console.log('[PaperImporter] PDF file read, size:', arrayBuffer.byteLength, 'bytes');

            // Load PDF
            console.log('[PaperImporter] Loading PDF document...');
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            console.log('[PaperImporter] PDF loaded, pages:', pdf.numPages);

            let fullText = '';

            // Extract text from each page
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n';

                if (pageNum % 10 === 0) {
                    console.log(`[PaperImporter] Processed ${pageNum}/${pdf.numPages} pages`);
                }
            }

            console.log('[PaperImporter] Text extraction complete, length:', fullText.length, 'characters');
            return fullText;
        } catch (error) {
            console.error('[PaperImporter] ❌ Error extracting PDF text:', error);
            console.error('[PaperImporter] Error details:', {
                name: error?.name,
                message: error?.message,
                stack: error?.stack
            });
            throw new Error(`Failed to extract text from PDF: ${error?.message || 'Unknown error'}`);
        }
    }

    /**
     * Estimate token count (rough: ~4 chars per token)
     */
    public estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Create note with frontmatter and summary
     */
    public async createPaperNote(
        metadata: PaperMetadata,
        summary: string,
        pdfFile: TFile,
        folder: string
    ): Promise<TFile> {
        // Sanitize title for filename
        const safeTitle = metadata.title.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
        const notePath = normalizePath(`${folder}/${safeTitle}.md`);

        // Check if note exists
        const existingNote = this.app.vault.getAbstractFileByPath(notePath);
        if (existingNote instanceof TFile) {
            new Notice('Note already exists. Opening existing note.');
            return existingNote;
        }

        // Ensure folder exists
        if (!this.app.vault.getAbstractFileByPath(normalizePath(folder))) {
            await this.app.vault.createFolder(normalizePath(folder));
        }

        // Format authors for YAML
        const authorsYaml = `[${metadata.authors.join(', ')}]`;
        const noteContent = `---
paper_id: "${metadata.paperId}"
title: "${metadata.title.replace(/"/g, '\\"')}"
authors: ${authorsYaml}
publication_date: "${metadata.date}"
abstract: "${metadata.abstract.replace(/"/g, '\\"')}"
comments: "${metadata.comments.replace(/"/g, '\\"')}"
pdf: "[[${pdfFile.path}]]"
url: "https://arxiv.org/abs/${metadata.paperId}"
tags: [research]
---

# ${metadata.title}

${summary}

---
*Summary generated on ${new Date().toISOString().split('T')[0]}*
`;

        // Create note
        const file = await this.app.vault.create(notePath, noteContent);
        return file;
    }

    /**
     * Create advanced paper note with AlphaXiv content
     */
    public async createAdvancedPaperNote(
        metadata: PaperMetadata,
        summary: string,
        pdfFile: TFile,
        folder: string,
        options: {
            alphaxivUrl?: string;
            alphaxivArticle?: string;
            podcastFile?: TFile;
            transcriptText?: string;
        }
    ): Promise<TFile> {
        // Sanitize title for filename
        const safeTitle = metadata.title.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
        const notePath = normalizePath(`${folder}/${safeTitle}.md`);

        // Check if note exists
        const existingNote = this.app.vault.getAbstractFileByPath(notePath);
        let appendContent = '';

        // If note exists, we'll append AlphaXiv content
        if (existingNote instanceof TFile) {
            const existingContent = await this.app.vault.read(existingNote);

            // Check if already has AlphaXiv content
            if (existingContent.includes('alphaxiv_url:')) {
                new Notice('AlphaXiv content already exists in this note.');
                return existingNote;
            }

            // Build additional content to append
            appendContent = this.buildAlphaXivContent(metadata, options, true);
        }

        // Ensure folder exists
        if (!this.app.vault.getAbstractFileByPath(normalizePath(folder))) {
            await this.app.vault.createFolder(normalizePath(folder));
        }

        // Format authors for YAML
        const authorsYaml = `[${metadata.authors.join(', ')}]`;

        // Build podcast path if exists
        const podcastPath = options.podcastFile ? `[[${options.podcastFile.path}]]` : '';

        // Build the full note content
        const noteContent = `---
paper_id: "${metadata.paperId}"
title: "${metadata.title.replace(/"/g, '\\"')}"
authors: ${authorsYaml}
publication_date: "${metadata.date}"
abstract: "${metadata.abstract.replace(/"/g, '\\"')}"
comments: "${metadata.comments.replace(/"/g, '\\"')}"
pdf: "[[${pdfFile.path}]]"
${podcastPath ? `podcast: "${podcastPath}"` : ''}
url: "https://arxiv.org/abs/${metadata.paperId}"
${options.alphaxivUrl ? `alphaxiv_url: "${options.alphaxivUrl}"` : ''}
tags: [research${options.alphaxivUrl ? ', alphaxiv' : ''}]
---

# ${metadata.title}

${this.buildAlphaXivContent(metadata, options, false)}

## AI Summary

${summary}

---
*Generated on ${new Date().toISOString().split('T')[0]}*
`;

        if (existingNote instanceof TFile) {
            // Append to existing note
            const existingContent = await this.app.vault.read(existingNote);
            const updatedContent = existingContent + '\n\n---\n\n## AlphaXiv Content Added\n' + appendContent;
            await this.app.vault.modify(existingNote, updatedContent);
            new Notice('AlphaXiv content added to existing note.');
            return existingNote;
        } else {
            // Create new note
            const file = await this.app.vault.create(notePath, noteContent);
            return file;
        }
    }

    /**
     * Build AlphaXiv content section
     */
    private buildAlphaXivContent(
        metadata: PaperMetadata,
        options: {
            alphaxivUrl?: string;
            alphaxivArticle?: string;
            podcastFile?: TFile;
            transcriptText?: string;
        },
        forAppend: boolean
    ): string {
        const parts: string[] = [];

        // Audio player section
        if (options.podcastFile) {
            parts.push(`## Listen

<audio controls src="${options.podcastFile.path}">
  <a href="${options.podcastFile.path}">Download Podcast</a>
</audio>
`);
        }

        // Transcript section (before summary, collapsible)
        if (options.transcriptText) {
            parts.push(`<details>
<summary>📝 Transcript</summary>

${options.transcriptText}

</details>
`);
        }

        // AlphaXiv article section - use raw HTML for proper rendering of formulas and images
        if (options.alphaxivArticle) {
            parts.push(`## AlphaXiv Overview

<div class="alphaxiv-article">
${options.alphaxivArticle}
</div>
`);
        }

        // Link to AlphaXiv if available
        if (options.alphaxivUrl) {
            parts.push(`---\n[View on AlphaXiv](${options.alphaxivUrl})`);
        }

        return parts.join('\n');
    }
}
