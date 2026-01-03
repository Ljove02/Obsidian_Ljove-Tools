import { requestUrl } from 'obsidian';

export interface AlphaXivResources {
    found: boolean;
    articleHtml?: string;
    articleMarkdown?: string;
    podcastUrl?: string;
    transcript?: string;
}

export class AlphaXivService {
    /**
     * Extract paper ID from arXiv URL or ID string
     */
    public extractPaperId(input: string): string | null {
        input = input.trim();

        // Direct ID: 2512.24601
        if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(input)) {
            return input.replace(/v\d+$/, '');
        }

        // URL: https://arxiv.org/abs/2512.24601
        const urlMatch = input.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?/i);
        if (urlMatch) {
            return urlMatch[1];
        }

        // arxiv:2512.24601
        const arxivMatch = input.match(/arxiv:(\d{4}\.\d{4,5})(v\d+)?/i);
        if (arxivMatch) {
            return arxivMatch[1];
        }

        return null;
    }

    /**
     * Build AlphaXiv URLs from paper ID
     * Note: AlphaXiv redirects from alphaxiv.org to www.alphaxiv.org
     */
    public buildUrls(paperId: string): {
        overview: string;
        resources: string;
    } {
        return {
            overview: `https://www.alphaxiv.org/overview/${paperId}`,
            resources: `https://www.alphaxiv.org/resources/${paperId}`
        };
    }

    /**
     * Scrape overview page for article content
     */
    public async fetchArticle(paperId: string): Promise<{ html: string | null; found: boolean }> {
        const { overview } = this.buildUrls(paperId);

        try {
            console.log(`[AlphaXivService] Fetching overview from: ${overview}`);

            const response = await requestUrl({
                url: overview,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Cache-Control': 'max-age=0'
                }
            });

            console.log(`[AlphaXivService] Response status: ${response.status}`);
            console.log(`[AlphaXivService] Response length: ${response.text.length} chars`);

            const html = response.text;

            // Check if page actually returns 404 status
            // Only treat as 404 if status code is 404
            // Don't check HTML content for "not found" as it can have false positives
            if (response.status === 404) {
                console.log(`[AlphaXivService] Overview page not found (404)`);
                console.log(`[AlphaXivService] HTML preview: ${html.slice(0, 500)}`);
                return { html: null, found: false };
            }

            // If status is 200 but page seems empty or malformed, still check content
            if (html.length < 100) {
                console.log(`[AlphaXivService] Overview page returned empty/too short content`);
                return { html: null, found: false };
            }

            // Find the article tag with the advanced summary
            // The article contains a nested div with the actual content
            const articleMatch = html.match(/<article[^>]*>[\s]*<div[^>]*class="[^"]*print:markdown-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i);

            if (articleMatch && articleMatch[1]) {
                let articleHtml = articleMatch[1].trim();

                // Clean up the article content
                articleHtml = this.cleanArticleContent(articleHtml);

                console.log(`[AlphaXivService] Found article, cleaned length: ${articleHtml.length} chars`);
                return { html: articleHtml, found: true };
            }

            console.log(`[AlphaXivService] No article tag found`);
            console.log(`[AlphaXivService] Looking for article tag...`);
            return { html: null, found: true };
        } catch (error) {
            console.error(`[AlphaXivService] Error fetching overview:`, error);
            return { html: null, found: false };
        }
    }

    /**
     * Clean article content by removing only UI elements (copy buttons)
     * Keep KaTeX formulas and images for proper rendering in Obsidian
     */
    private cleanArticleContent(html: string): string {
        let cleaned = html;

        // Remove copy LaTeX buttons and their wrappers (only UI elements we don't need)
        cleaned = cleaned.replace(/<button[^>]*title="Copy LaTeX"[^>]*>[\s\S]*?<\/button>/gi, '');
        cleaned = cleaned.replace(/<button[^>]*aria-label="Copy LaTeX to clipboard"[^>]*>[\s\S]*?<\/button>/gi, '');

        // Remove empty button wrappers
        cleaned = cleaned.replace(/<div[^>]*class="[^"]*absolute[^"]*top-2[^"]*"[^>]*>\s*<\/div>/gi, '');

        return cleaned;
    }

    /**
     * Scrape resources page for podcast URL and transcript
     */
    public async fetchResources(paperId: string): Promise<{
        podcastUrl: string | null;
        transcript: string | null;
        found: boolean;
    }> {
        const { resources } = this.buildUrls(paperId);

        try {
            console.log(`[AlphaXivService] Fetching resources from: ${resources}`);

            const response = await requestUrl({
                url: resources,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Cache-Control': 'max-age=0'
                }
            });

            console.log(`[AlphaXivService] Response status: ${response.status}`);
            console.log(`[AlphaXivService] Response length: ${response.text.length} chars`);

            const html = response.text;

            // Check if page actually returns 404 status
            // Only treat as 404 if status code is 404
            // Don't check HTML content for "not found" as it can have false positives
            if (response.status === 404) {
                console.log(`[AlphaXivService] Resources page not found (404)`);
                console.log(`[AlphaXivService] HTML preview: ${html.slice(0, 500)}`);
                return { podcastUrl: null, transcript: null, found: false };
            }

            // If status is 200 but page seems empty or malformed, still check content
            if (html.length < 100) {
                console.log(`[AlphaXivService] Resources page returned empty/too short content`);
                return { podcastUrl: null, transcript: null, found: false };
            }

            // Find podcast URL - look for download button with MP3 link
            let podcastUrl: string | null = null;

            // Pattern: Look for <a> tags with .mp3 in href (the download button)
            const podcastLinkMatch = html.match(/<a[^>]*href=["']([^"']*\.mp3[^"']*)["'][^>]*>/i);
            if (podcastLinkMatch) {
                podcastUrl = podcastLinkMatch[1];
                console.log(`[AlphaXivService] Found podcast URL from download link: ${podcastUrl}`);
            }

            // Alternative: Look for audio element source
            if (!podcastUrl) {
                const audioMatch = html.match(/<audio[^>]*src=["']([^"']+)["'][^>]*>/i);
                if (audioMatch) {
                    podcastUrl = audioMatch[1];
                    console.log(`[AlphaXivService] Found podcast URL from audio element: ${podcastUrl}`);
                }
            }

            // Find transcript - follow the exact structure from the HTML
            let transcript: string | null = null;

            // Pattern: Look for the exact transcript structure
            // <div class="text-sm font-medium">Transcript</div>
            // <div class="text-xs ... wrap-break-word ...">
            const transcriptSectionMatch = html.match(/<div[^>]*class="[^"]*text-sm[^"]*font-medium[^"]*"[^>]*>\s*Transcript\s*<\/div>\s*<div[^>]*class="[^"]*wrap-break-word[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

            if (transcriptSectionMatch && transcriptSectionMatch[1]) {
                // Clean up the transcript text
                transcript = transcriptSectionMatch[1]
                    .replace(/<[^>]+>/g, ' ') // Remove any remaining HTML tags
                    .replace(/\s+/g, ' ')     // Normalize whitespace
                    .trim();

                console.log(`[AlphaXivService] Found transcript, length: ${transcript.length} chars`);
                console.log(`[AlphaXivService] Transcript preview: ${transcript.slice(0, 200)}...`);
            }

            // Alternative pattern: Look for any div containing "Transcript" followed by content
            if (!transcript) {
                const altMatch = html.match(/Transcript<\/div>\s*<div[^>]*>([\s\S]{0,5000})/i);
                if (altMatch) {
                    transcript = altMatch[1]
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    console.log(`[AlphaXivService] Found transcript (alt pattern), length: ${transcript.length} chars`);
                }
            }

            // Debug: Show what patterns we're looking for
            console.log(`[AlphaXivService] Checking for podcast patterns...`);
            console.log(`[AlphaXivService] Has mp3 link: ${podcastLinkMatch ? 'yes' : 'no'}`);
            console.log(`[AlphaXivService] Has transcript pattern: ${transcriptSectionMatch ? 'yes' : 'no'}`);

            return {
                podcastUrl: podcastUrl,
                transcript: transcript,
                found: true
            };
        } catch (error) {
            console.error(`[AlphaXivService] Error fetching resources:`, error);
            return { podcastUrl: null, transcript: null, found: false };
        }
    }

    /**
     * Download podcast MP3 file
     */
    public async downloadPodcast(podcastUrl: string, savePath: string): Promise<boolean> {
        try {
            console.log(`[AlphaXivService] Downloading podcast to: ${savePath}`);
            const response = await requestUrl({
                url: podcastUrl,
                method: 'GET'
            });

            if (response.status !== 200) {
                console.error(`[AlphaXivService] Failed to download podcast: HTTP ${response.status}`);
                return false;
            }

            // The response.arrayBuffer contains the MP3 data
            console.log(`[AlphaXivService] Podcast download successful, size: ${response.arrayBuffer?.byteLength || 'unknown'}`);
            return true;
        } catch (error) {
            console.error(`[AlphaXivService] Error downloading podcast:`, error);
            return false;
        }
    }

    /**
     * Convert HTML article to Markdown
     * Uses basic conversion - complex content may remain as HTML
     */
    public htmlToMarkdown(html: string): string {
        let markdown = html;

        // Pre-process: Extract LaTeX from annotations and convert to $$...$$
        markdown = markdown.replace(/<annotation encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/gi, (match, latex) => {
            return `$$${latex.trim()}$$`;
        });

        // Pre-process: Convert katex-display blocks to $$...$$
        const katexBlocks: string[] = [];
        let counter = 0;
        markdown = markdown.replace(/<span class="katex-display"[^>]*>[\s\S]*?<span class="katex"[^>]*>[\s\S]*?<\/span>[\s\S]*?<\/span>/gi, (match) => {
            // Extract just the mathml content
            const latexMatch = match.match(/<annotation encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/i);
            if (latexMatch) {
                const placeholder = `%%KATEX_BLOCK_${counter++}%%`;
                katexBlocks.push(`$$${latexMatch[1].trim()}$$`);
                return placeholder;
            }
            return match;
        });

        // Convert headers
        markdown = markdown.replace(/<h1[^>]*id="[^"]*"[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
        markdown = markdown.replace(/<h2[^>]*id="[^"]*"[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
        markdown = markdown.replace(/<h3[^>]*id="[^"]*"[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
        markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');

        // Convert headers without id
        markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
        markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
        markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
        markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');

        // Convert bold/strong
        markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
        markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');

        // Convert italic/em
        markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
        markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

        // Convert links
        markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');

        // Convert lists
        markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
        markdown = markdown.replace(/<\/ul>/gi, '\n');
        markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

        markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
        markdown = markdown.replace(/<\/ol>/gi, '\n');
        markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '1. $1\n');

        // Convert paragraphs
        markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

        // Convert line breaks
        markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

        // Convert blockquotes
        markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1\n\n');

        // Convert code blocks
        markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```\n');
        markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

        // Convert divs (just remove wrapper, keep content)
        markdown = markdown.replace(/<div[^>]*>(.*?)<\/div>/gis, '$1\n\n');

        // Remove remaining HTML tags
        markdown = markdown.replace(/<[^>]+>/g, '');

        // Restore katex blocks
        katexBlocks.forEach((block, i) => {
            markdown = markdown.replace(`%%KATEX_BLOCK_${i}%%`, block);
        });

        // Clean up excessive whitespace
        markdown = markdown.replace(/\n{3,}/g, '\n\n');
        markdown = markdown.replace(/[ \t]+/g, ' ');

        // Trim
        markdown = markdown.trim();

        return markdown;
    }
}
