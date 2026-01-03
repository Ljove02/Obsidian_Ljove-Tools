/**
 * LatexRenderer - Handles KaTeX loading and LaTeX rendering
 * Provides utilities for rendering mathematical expressions in HTML elements
 */

export class LatexRenderer {
    /**
     * Render LaTeX expressions in text and update the HTML element
     * @param element - HTML element to render into
     * @param text - Text containing LaTeX expressions ($...$ or $$...$$)
     */
    public async renderLatex(element: HTMLElement, text: string): Promise<void> {
        // Replace LaTeX expressions with rendered math
        const latexRegex = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
        let processedText = text;

        // Find all LaTeX expressions
        const matches = [...text.matchAll(latexRegex)];

        for (const match of matches) {
            const latex = match[1] || match[2]; // $$ or $ delimited - DELIMITERS ALREADY REMOVED BY REGEX GROUPS
            const isBlock = !!match[1]; // true for $$, false for $

            try {
                // Create a math element with the raw LaTeX content (no delimiters)
                const mathEl = document.createElement(isBlock ? 'div' : 'span');
                mathEl.className = isBlock ? 'math-block' : 'math-inline';
                mathEl.textContent = latex.trim(); // Raw LaTeX without $ delimiters

                processedText = processedText.replace(match[0], mathEl.outerHTML);
            } catch (error) {
                console.error('Error processing LaTeX:', error);
                // Keep original text if processing fails
            }
        }

        element.innerHTML = processedText;

        // Now render all math elements using KaTeX
        await this.renderMathElements(element);
    }

    /**
     * Render LaTeX expressions within markdown-formatted text
     * @param element - HTML element to render into
     * @param text - Text containing both markdown and LaTeX
     * @param renderMarkdownFn - Function to render markdown (injected dependency)
     */
    public async renderLatexWithMarkdown(
        element: HTMLElement,
        text: string,
        renderMarkdownFn: (text: string) => string
    ): Promise<void> {
        // First render markdown
        const markdownHtml = renderMarkdownFn(text);

        // Then process LaTeX in the markdown
        const latexRegex = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
        let processedText = markdownHtml;

        // Find all LaTeX expressions
        const matches = [...markdownHtml.matchAll(latexRegex)];

        for (const match of matches) {
            const latex = match[1] || match[2]; // $$ or $ delimited
            const isBlock = !!match[1]; // true for $$, false for $

            try {
                // Create a math element with the raw LaTeX content
                const mathEl = document.createElement(isBlock ? 'div' : 'span');
                mathEl.className = isBlock ? 'math-block' : 'math-inline';
                mathEl.textContent = latex.trim(); // Raw LaTeX without $ delimiters

                processedText = processedText.replace(match[0], mathEl.outerHTML);
            } catch (error) {
                console.error('Error processing LaTeX:', error);
                // Keep original text if processing fails
            }
        }

        element.innerHTML = processedText;

        // Now render all math elements using KaTeX
        await this.renderMathElements(element);
    }

    /**
     * Render all math elements in a container using KaTeX
     * @param container - HTML element containing .math-inline or .math-block elements
     */
    public async renderMathElements(container: HTMLElement): Promise<void> {
        // Load KaTeX if not already loaded
        if (!this.isKatexLoaded()) {
            await this.loadKatex();
        }

        // Find all math elements and render them
        const mathElements = container.querySelectorAll('.math-inline, .math-block');

        mathElements.forEach((mathEl) => {
            try {
                const latex = mathEl.textContent || '';
                const isBlock = mathEl.classList.contains('math-block');

                // Check if this is a matrix or other display math that needs display mode
                const needsDisplayMode = isBlock || /\\begin\{(matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix|cases|align|equation|split|gather|multline)\}/.test(latex);

                if ((window as any).katex) {
                    // KaTeX expects raw LaTeX without $ delimiters
                    (window as any).katex.render(latex, mathEl as HTMLElement, {
                        throwOnError: false,
                        displayMode: needsDisplayMode,
                        strict: false,
                        trust: false,
                        macros: {
                            '\\RR': '\\mathbb{R}',
                            '\\NN': '\\mathbb{N}',
                            '\\ZZ': '\\mathbb{Z}',
                            '\\QQ': '\\mathbb{Q}',
                            '\\CC': '\\mathbb{C}'
                        }
                    });
                } else {
                    // Fallback styling if KaTeX fails to load
                    (mathEl as HTMLElement).style.fontFamily = 'monospace';
                    (mathEl as HTMLElement).style.backgroundColor = 'var(--background-secondary)';
                    (mathEl as HTMLElement).style.padding = isBlock ? '8px 12px' : '2px 4px';
                    (mathEl as HTMLElement).style.borderRadius = '3px';
                    (mathEl as HTMLElement).style.fontSize = isBlock ? '1.1em' : '0.9em';
                    if (isBlock) {
                        (mathEl as HTMLElement).style.textAlign = 'center';
                        (mathEl as HTMLElement).style.margin = '8px 0';
                        (mathEl as HTMLElement).style.display = 'block';
                    }
                }
            } catch (error) {
                console.error('Error rendering math with KaTeX:', error);
                // Keep the original LaTeX text if rendering fails
            }
        });
    }

    /**
     * Check if KaTeX library is loaded
     */
    public isKatexLoaded(): boolean {
        return typeof (window as any).katex !== 'undefined';
    }

    /**
     * Load KaTeX library from CDN
     */
    public async loadKatex(): Promise<void> {
        if (this.isKatexLoaded()) {
            return;
        }

        try {
            // Skip CSS loading to avoid CSP issues - we'll use local styles in styles.css

            // Only load KaTeX JS (try CDN first, fallback to local styles if it fails)
            return new Promise((resolve, reject) => {
                const katexJS = document.createElement('script');
                katexJS.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
                katexJS.crossOrigin = 'anonymous';
                katexJS.onload = () => resolve();
                katexJS.onerror = () => {
                    console.warn('Failed to load KaTeX from CDN, using fallback styles');
                    resolve(); // Don't reject, just use fallback styling
                };
                document.head.appendChild(katexJS);
            });
        } catch (error) {
            console.error('Error loading KaTeX:', error);
            // Don't throw error, just use fallback styling
        }
    }
}
