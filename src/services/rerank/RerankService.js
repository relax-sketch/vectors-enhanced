import { RerankConfig } from './RerankConfig.js';

/**
 * Service class for handling document reranking
 */
export class RerankService {
    /**
     * @param {Object} settings - Global settings object
     * @param {Object} options - Additional options
     * @param {Function} options.toastr - Toast notification function
     */
    constructor(settings, options = {}) {
        this.config = new RerankConfig(settings);
        this.settings = settings; // Keep reference to settings for checking show_query_notification
        this.toastr = options.toastr || console;
        this.lastNotifyTime = 0;
        this.NOTIFICATION_COOLDOWN = 5000; // 5 seconds
    }

    /**
     * Check if rerank is enabled and properly configured
     * @returns {boolean}
     */
    isEnabled() {
        const config = this.config.getConfig();
        const validation = this.config.validateConfig();
        return config.enabled && validation.valid;
    }

    /**
     * Rerank search results
     * @param {string} query - Query text
     * @param {import('./RerankTypes.js').RerankItem[]} results - Array of search results
     * @returns {Promise<import('./RerankTypes.js').RerankItem[]>} Reranked results
     */
    async rerankResults(query, results, options = {}) {
        if (!this.isEnabled() || results.length === 0) {
            return results;
        }

        const config = this.config.getConfig();
        console.debug('Vectors: Reranking enabled. Starting rerank process...');

        try {
            // Index results for tracking
            const indexedResults = results.map((result, index) => ({
                ...result,
                _rerank_index: index
            }));

            // Prepare documents for reranking
            const documentsToRerank = indexedResults.map((x, index) => ({
                text: x.text,
                index: index
            }));

            // Build rerank request
            const rerankRequest = this._buildRerankRequest(query, documentsToRerank, config);

            // Send rerank request
            const rerankResponse = await this._sendRerankRequest(config, rerankRequest);

            // Process response
            const rerankedResults = this._processRerankResponse(
                indexedResults,
                rerankResponse,
                config.hybrid_alpha
            );

            // Show notification if enabled
            if (options.suppressNotification !== true) {
                this._showNotification(config, results.length, rerankedResults.length);
            }

            return rerankedResults;

        } catch (error) {
            console.error('Vectors: Reranking failed. Falling back to original similarity search.', error);
            
            // Clean up any rerank-related properties
            const cleanedResults = results.map(result => {
                const { hybrid_score, rerank_score, original_score, _rerank_index, _rerank_success, ...originalResult } = result;
                return originalResult;
            });
            
            // Sort by original score
            cleanedResults.sort((a, b) => (b.score || 0) - (a.score || 0));
            
            this.toastr.error('Rerank失败，使用原始搜索结果。');
            return cleanedResults;
        }
    }

    /**
     * Build rerank request body
     * @private
     */
    _buildRerankRequest(query, documents, config) {
        const request = {
            query: query,
            documents: documents.map(x => x.text),
            model: config.model,
            top_n: Math.min(documents.length, config.top_n)
        };

        // Add deduplication instruction if enabled
        if (config.deduplication_enabled && config.deduplication_instruction) {
            request.instruction = config.deduplication_instruction;
            console.debug('Vectors: Using deduplication instruction for rerank');
        }

        return request;
    }

    /**
     * Send rerank request to API
     * @private
     */
    async _sendRerankRequest(config, requestBody) {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Rerank API failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
        }

        const data = await response.json();
        console.debug('Vectors: Rerank API response:', data);
        return data;
    }

    /**
     * Process rerank response and calculate hybrid scores
     * @private
     */
    _processRerankResponse(indexedResults, rerankData, hybridAlpha) {
        if (!rerankData.results || !Array.isArray(rerankData.results)) {
            throw new Error('Unexpected rerank API response format');
        }

        const hasExplicitIndex = rerankData.results.some(r => Number.isInteger(r.index));
        const resultsByIndex = new Map();
        if (hasExplicitIndex) {
            rerankData.results.forEach(item => {
                if (Number.isInteger(item.index)) {
                    resultsByIndex.set(item.index, item);
                }
            });
        }

        const rerankedResults = indexedResults.map((result, arrayIndex) => {
            let relevanceScore = 0;

            const rerankedResult = hasExplicitIndex
                ? resultsByIndex.get(result._rerank_index)
                : rerankData.results[arrayIndex];
            
            if (rerankedResult && typeof rerankedResult.relevance_score === 'number') {
                relevanceScore = rerankedResult.relevance_score;
            } else if (rerankedResult && typeof rerankedResult.score === 'number') {
                // Compatibility with APIs using 'score' instead of 'relevance_score'
                relevanceScore = rerankedResult.score;
            }
            
            // Calculate hybrid score
            const originalScore = Number(result.score) || 0;
            const hybridScore = relevanceScore * hybridAlpha + originalScore * (1 - hybridAlpha);
            
            // Remove temporary index property
            const { _rerank_index, ...cleanResult } = result;
            
            return {
                ...cleanResult,
                hybrid_score: hybridScore,
                rerank_score: relevanceScore,
                original_score: originalScore,
                _rerank_success: relevanceScore > 0
            };
        });
        
        // Sort by hybrid score
        rerankedResults.sort((a, b) => (b.hybrid_score || 0) - (a.hybrid_score || 0));
        
        // Log statistics
        const successCount = rerankedResults.filter(r => r._rerank_success).length;
        console.debug(`Vectors: Rerank completed. ${successCount}/${rerankedResults.length} items successfully reranked`);
        
        // Log top results for debugging
        console.debug('Vectors: Top 5 results after rerank:', rerankedResults.slice(0, 5).map((r, i) => ({
            index: i,
            hybrid_score: r.hybrid_score?.toFixed(4),
            rerank_score: r.rerank_score?.toFixed(4),
            original_score: r.original_score?.toFixed(4),
            text_preview: r.text?.substring(0, 50) + '...'
        })));
        
        // Warn if no items were reranked successfully
        if (successCount === 0 && rerankedResults.length > 0) {
            console.warn('Vectors: No items were successfully reranked. API response format may be incompatible.');
        }
        
        return rerankedResults;
    }

    /**
     * Show rerank notification if enabled
     * @private
     */
    _showNotification(config, originalCount, rerankedCount) {
        // Skip notification if main query notification is enabled (to avoid duplicates)
        if (this.settings.show_query_notification) {
            console.debug('Vectors: Rerank notification skipped - main query notification is enabled');
            return;
        }

        if (!config.success_notify) {
            return;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastNotifyTime < this.NOTIFICATION_COOLDOWN) {
            console.debug('Vectors: Rerank notification skipped due to cooldown');
            return;
        }

        this.toastr.info(
            `Rerank completed: ${originalCount} → ${rerankedCount} results`,
            'Rerank Success',
            { timeOut: 2000 }
        );

        this.lastNotifyTime = currentTime;
    }

    /**
     * Limit results based on configuration
     * @param {import('./RerankTypes.js').RerankItem[]} results - Reranked results
     * @param {number} maxResults - Maximum results from main query
     * @returns {import('./RerankTypes.js').RerankItem[]} Limited results
     */
    limitResults(results, maxResults) {
        const config = this.config.getConfig();
        const finalLimit = Math.min(config.top_n, maxResults);
        
        if (results.length > finalLimit) {
            console.debug(`Vectors: Limiting final results from ${results.length} to ${finalLimit}`);
            return results.slice(0, finalLimit);
        }
        
        return results;
    }
}
