/**
 * MarkdownRenderer - Simple markdown to HTML converter
 * Used for streaming responses and basic markdown formatting
 */

export class MarkdownRenderer {
    /**
     * Convert markdown text to HTML
     * Supports headers, bold, italic, code blocks, lists, and paragraphs
     * @param text - Markdown formatted text
     * @returns HTML string
     */
    public static renderMarkdown(text: string): string {
        let html = text;

        // Headers
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Lists
        html = html.replace(/^\* (.*$)/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');

        // Wrap consecutive list items in ul/ol
        html = html.replace(/(<li>.*<\/li>)/g, (match) => {
            return `<ul>${match}</ul>`;
        });

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = `<p>${html}</p>`;

        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<[^>]+>)<\/p>/g, '$1');

        return html;
    }
}
