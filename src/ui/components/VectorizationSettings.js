/**
 * VectorizationSettings Component - Manages vectorization source selection and model configuration
 *
 * Handles:
 * - Source selection (Transformers, vLLM, Ollama)
 * - Model configuration for each source
 * - Vectorization parameters (chunk size, overlap, thresholds)
 * - Source-specific settings validation
 */

export class VectorizationSettings {
    constructor(dependencies = {}) {
        this.settings = dependencies.settings;
        this.configManager = dependencies.configManager;
        this.onSettingsChange = dependencies.onSettingsChange || (() => {});

        // Source configurations
        this.sourceConfigs = {
            transformers: {
                selector: '#vectors_enhanced_transformers_settings',
                fields: ['local_model']
            },
            vllm: {
                selector: '#vectors_enhanced_vllm_settings',
                fields: ['vllm_model', 'vllm_url', 'vllm_api_key']
            },
            ollama: {
                selector: '#vectors_enhanced_ollama_settings',
                fields: ['ollama_model', 'ollama_url', 'ollama_keep']
            }
        };

        // Injection-related fields from InjectionSettings.js
        this.injectionFields = [
            'template',
            'depth',
            'depth_role',
            'include_wi',
        ];
        this.contentTagFields = ['tag_chat', 'tag_wi', 'tag_file'];

        this.initialized = false;
    }

    /**
     * Initialize VectorizationSettings component
     */
    async init() {
        if (this.initialized) {
            console.warn('VectorizationSettings: Already initialized');
            return;
        }

        try {
            this.bindEventListeners();
            this.loadCurrentSettings();
            this.updateSourceVisibility();
            this.updatePositionVisibility(); // From InjectionSettings
            this.initialized = true;
            console.log('VectorizationSettings: Initialized successfully');
        } catch (error) {
            console.error('VectorizationSettings: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Bind event listeners for vectorization settings
     */
    bindEventListeners() {
        this.bindEmbeddingPresetListeners();

        // Source selection change
        $('#vectors_enhanced_source').on('change', (e) => {
            const newSource = e.target.value;
            this.handleSourceChange(newSource);
        });

        // Model and URL inputs for each source
        this.bindSourceSpecificListeners('transformers');
        this.bindSourceSpecificListeners('vllm');
        this.bindSourceSpecificListeners('ollama');

        // General vectorization parameters
        this.bindParameterListeners();

        console.log('VectorizationSettings: Event listeners bound');

        // Listeners from InjectionSettings.js
        $('#vectors_enhanced_template').on('input', (e) => this.handleFieldChange('template', e.target.value));
        this.contentTagFields.forEach(field => {
            $(`#vectors_enhanced_${field}`).on('input', (e) => {
                const key = field.replace('tag_', '');
                this.settings.content_tags[key] = e.target.value;
                this.saveSettings();
                this.onSettingsChange(`content_tags.${key}`, e.target.value);
            });
        });
        $('input[name="vectors_position"]').on('change', (e) => this.handlePositionChange(e.target.value));
        $('#vectors_enhanced_depth').on('input', (e) => this.handleFieldChange('depth', parseInt(e.target.value) || 0));
        $('#vectors_enhanced_depth_role').on('change', (e) => this.handleFieldChange('depth_role', parseInt(e.target.value) || 0));
        $('#vectors_enhanced_include_wi').on('change', (e) => this.handleFieldChange('include_wi', e.target.checked));
    }

    /**
     * Bind embedding API/model preset controls.
     */
    bindEmbeddingPresetListeners() {
        $('#vectors_enhanced_embedding_preset_select').on('change', (e) => {
            this.applyEmbeddingPreset(e.target.value);
        });

        $('#vectors_enhanced_embedding_preset_save').on('click', async (e) => {
            e.preventDefault();
            await this.saveCurrentEmbeddingPreset();
        });

        $('#vectors_enhanced_embedding_preset_delete').on('click', (e) => {
            e.preventDefault();
            this.deleteSelectedEmbeddingPreset();
        });
    }

    /**
     * Bind event listeners for a specific source
     */
    bindSourceSpecificListeners(source) {
        const config = this.sourceConfigs[source];
        if (!config) return;

        config.fields.forEach(field => {
            const fieldId = `#vectors_enhanced_${field}`;
            $(fieldId).on('input change', (e) => {
                this.handleFieldChange(field, e.target.value, e.target.type === 'checkbox' ? e.target.checked : undefined);
            });
        });
    }

    /**
     * Bind event listeners for general parameters
     */
    bindParameterListeners() {
        const parameters = [
            'chunk_size',
            'overlap_percent',
            'score_threshold',
            'force_chunk_delimiter',
            'query_messages',
            'max_results',
            'enabled',
            'show_query_notification',
            'detailed_notification'
        ];

        parameters.forEach(param => {
            const fieldId = `#vectors_enhanced_${param}`;
            const field = $(fieldId);

            if (field.length) {
                field.on('input change', (e) => {
                    let value = e.target.value;

                    // Handle different input types
                    if (e.target.type === 'checkbox') {
                        value = e.target.checked;
                    } else if (e.target.type === 'number') {
                        value = parseFloat(value) || 0;
                    }

                    this.handleFieldChange(param, value);
                });
            }
        });

        // Special handling for notification details visibility
        $('#vectors_enhanced_show_query_notification').on('change', (e) => {
            this.toggleNotificationDetails(e.target.checked);
        });
    }

    /**
     * Handle position selection change (from InjectionSettings)
     */
    handlePositionChange(positionValue) {
        console.log(`VectorizationSettings: Position changed to ${positionValue}`);
        this.settings.position = parseInt(positionValue);
        this.saveSettings();
        this.updatePositionVisibility();
        this.onSettingsChange('position', this.settings.position);
    }

    /**
     * Handle source selection change
     */
    handleSourceChange(newSource) {
        console.log(`VectorizationSettings: Source changed to ${newSource}`);

        // Update settings
        this.settings.source = newSource;
        this.saveSettings();

        // Update UI visibility
        this.updateSourceVisibility();

        // Validate source configuration
        this.validateSourceConfig(newSource);

        // Notify settings change
        this.onSettingsChange('source', newSource);
    }

    /**
     * Fields that belong to embedding connection/model configuration only.
     * Chunking, thresholds and query settings are intentionally excluded.
     */
    getEmbeddingConfigFields() {
        return [
            'source',
            'local_model',
            'vllm_url',
            'vllm_model',
            'vllm_api_key',
            'ollama_url',
            'ollama_model',
            'ollama_keep'
        ];
    }

    /**
     * Build a preset object from current embedding API/model settings.
     */
    buildCurrentEmbeddingPreset(name) {
        const preset = {
            id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            createdAt: Date.now(),
            config: {}
        };

        this.getEmbeddingConfigFields().forEach(field => {
            preset.config[field] = this.settings[field];
        });

        return preset;
    }

    /**
     * Render embedding preset dropdown.
     */
    renderEmbeddingPresetOptions() {
        const select = $('#vectors_enhanced_embedding_preset_select');
        if (!select.length) return;

        const presets = Array.isArray(this.settings.embedding_config_presets)
            ? this.settings.embedding_config_presets
            : [];

        const currentValue = select.val();
        select.empty();
        select.append('<option value="">-- 选择已保存配置 --</option>');
        presets.forEach(preset => {
            select.append($('<option></option>').val(preset.id).text(preset.name));
        });

        if (currentValue && presets.some(preset => preset.id === currentValue)) {
            select.val(currentValue);
        }
    }

    /**
     * Save current embedding API/model fields as a named preset.
     */
    async saveCurrentEmbeddingPreset() {
        const defaultName = this.getDefaultEmbeddingPresetName();
        let name = window.prompt('请输入嵌入配置名称', defaultName);
        if (!name || !name.trim()) return;
        name = name.trim();

        if (!Array.isArray(this.settings.embedding_config_presets)) {
            this.settings.embedding_config_presets = [];
        }

        const existingIndex = this.settings.embedding_config_presets.findIndex(preset => preset.name === name);
        const preset = this.buildCurrentEmbeddingPreset(name);

        if (existingIndex >= 0) {
            preset.id = this.settings.embedding_config_presets[existingIndex].id;
            preset.createdAt = this.settings.embedding_config_presets[existingIndex].createdAt || preset.createdAt;
            preset.updatedAt = Date.now();
            this.settings.embedding_config_presets[existingIndex] = preset;
        } else {
            this.settings.embedding_config_presets.push(preset);
        }

        this.saveSettings();
        this.renderEmbeddingPresetOptions();
        $('#vectors_enhanced_embedding_preset_select').val(preset.id);
        this.onSettingsChange('embedding_config_presets', this.settings.embedding_config_presets);
        window.toastr?.success?.('嵌入配置已保存');
    }

    /**
     * Apply a saved embedding preset to current settings and UI.
     */
    applyEmbeddingPreset(presetId) {
        if (!presetId) return;

        const presets = Array.isArray(this.settings.embedding_config_presets)
            ? this.settings.embedding_config_presets
            : [];
        const preset = presets.find(item => item.id === presetId);
        if (!preset) return;

        this.getEmbeddingConfigFields().forEach(field => {
            if (Object.prototype.hasOwnProperty.call(preset.config || {}, field)) {
                // Do not erase an existing API key when applying a preset saved without one.
                if (field === 'vllm_api_key' && !preset.config[field]) {
                    return;
                }
                this.settings[field] = preset.config[field];
            }
        });

        this.saveSettings();
        this.loadCurrentSettings();
        this.updateSourceVisibility();
        this.onSettingsChange('embedding_config_preset_applied', preset.name);
        window.toastr?.success?.(`已切换嵌入配置：${preset.name}`);
    }

    /**
     * Delete the selected embedding preset.
     */
    deleteSelectedEmbeddingPreset() {
        const select = $('#vectors_enhanced_embedding_preset_select');
        const presetId = select.val();
        if (!presetId) return;

        const presets = Array.isArray(this.settings.embedding_config_presets)
            ? this.settings.embedding_config_presets
            : [];
        const preset = presets.find(item => item.id === presetId);
        if (!preset) return;

        if (!window.confirm(`删除嵌入配置“${preset.name}”？`)) return;

        this.settings.embedding_config_presets = presets.filter(item => item.id !== presetId);
        this.saveSettings();
        this.renderEmbeddingPresetOptions();
        select.val('');
        this.onSettingsChange('embedding_config_presets', this.settings.embedding_config_presets);
        window.toastr?.success?.('嵌入配置已删除');
    }

    /**
     * Generate a readable default preset name from current source and model.
     */
    getDefaultEmbeddingPresetName() {
        const source = this.settings.source || 'embedding';
        const model = source === 'vllm'
            ? this.settings.vllm_model
            : source === 'ollama'
                ? this.settings.ollama_model
                : this.settings.local_model;

        return model ? `${source} - ${model}` : source;
    }

    /**
     * Handle individual field changes
     */
    handleFieldChange(field, value, checkboxValue) {
        console.log(`VectorizationSettings: Field ${field} changed to:`, value);

        // Handle checkbox fields
        if (checkboxValue !== undefined) {
            value = checkboxValue;
        }

        // Update settings object
        if (this.settings.hasOwnProperty(field)) {
            this.settings[field] = value;
        }
        this.saveSettings();

        // Special handling for certain fields
        if (field === 'show_query_notification') {
            this.toggleNotificationDetails(value);
        } else if (field === 'enabled' && !value) {
            // When vector query is disabled, also disable rerank
            this.disableRerank();
        } else if (field === 'template') {
            this.validateTemplate(value);
        }

        // Notify settings change
        this.onSettingsChange(field, value);
    }

    /**
     * Update source-specific settings visibility
     */
    updateSourceVisibility() {
        const currentSource = this.settings.source;

        // Hide all source-specific settings
        Object.values(this.sourceConfigs).forEach(config => {
            $(config.selector).hide();
        });

        // Show current source settings
        if (this.sourceConfigs[currentSource]) {
            $(this.sourceConfigs[currentSource].selector).show();
        }

        console.log(`VectorizationSettings: Updated visibility for source: ${currentSource}`);
    }

    /**
     * Toggle notification details visibility
     */
    toggleNotificationDetails(show) {
        const detailsSection = $('#vectors_enhanced_notification_details');
        if (show) {
            detailsSection.show();
        } else {
            detailsSection.hide();
        }
    }

    /**
     * Disable rerank when vector query is disabled
     */
    disableRerank() {
        console.log('VectorizationSettings: Disabling rerank due to vector query being disabled');

        // Update rerank settings
        this.settings.rerank_enabled = false;

        // Update the UI checkbox
        const rerankCheckbox = $('#vectors_enhanced_rerank_enabled');
        if (rerankCheckbox.length) {
            rerankCheckbox.prop('checked', false);
            // Trigger change event to update the QuerySettings component
            rerankCheckbox.trigger('change');
        }

        // Save settings
        this.saveSettings();

        // Notify the change
        this.onSettingsChange('rerank_enabled', false);
    }

    /**
     * Load current settings into UI elements
     */
    loadCurrentSettings() {
        console.log('VectorizationSettings: Loading current settings...');

        // Load source selection
        $('#vectors_enhanced_source').val(this.settings.source);
        this.renderEmbeddingPresetOptions();

        // Load source-specific fields
        Object.entries(this.sourceConfigs).forEach(([source, config]) => {
            config.fields.forEach(field => {
                const fieldId = `#vectors_enhanced_${field}`;
                const element = $(fieldId);

                if (element.length && this.settings[field] !== undefined) {
                    if (element.attr('type') === 'checkbox') {
                        element.prop('checked', this.settings[field]);
                    } else {
                        element.val(this.settings[field]);
                    }
                }
            });
        });

        // Load general parameters
        const parameters = [
            'chunk_size', 'overlap_percent', 'score_threshold', 'force_chunk_delimiter',
            'query_messages', 'max_results', 'enabled', 'show_query_notification', 'detailed_notification'
        ];

        parameters.forEach(param => {
            const fieldId = `#vectors_enhanced_${param}`;
            const element = $(fieldId);

            if (element.length && this.settings[param] !== undefined) {
                if (element.attr('type') === 'checkbox') {
                    element.prop('checked', this.settings[param]);
                } else {
                    element.val(this.settings[param]);
                }
            }
        });

        // Update notification details visibility
        this.toggleNotificationDetails(this.settings.show_query_notification);

        console.log('VectorizationSettings: Settings loaded');

        // Load settings from InjectionSettings.js
        this.injectionFields.forEach(field => {
            const element = $(`#vectors_enhanced_${field}`);
            if (element.length && this.settings[field] !== undefined) {
                if (element.attr('type') === 'checkbox') {
                    element.prop('checked', this.settings[field]);
                } else {
                    element.val(this.settings[field]);
                }
            }
        });
        this.contentTagFields.forEach(field => {
            const key = field.replace('tag_', '');
            const element = $(`#vectors_enhanced_${field}`);
            if (element.length && this.settings.content_tags[key] !== undefined) {
                element.val(this.settings.content_tags[key]);
            }
        });
        if (this.settings.position !== undefined) {
            $(`input[name="vectors_position"][value="${this.settings.position}"]`).prop('checked', true);
        }
    }

    /**
     * Validate source configuration
     */
    validateSourceConfig(source) {
        const config = this.sourceConfigs[source];
        if (!config) {
            console.warn(`VectorizationSettings: Unknown source: ${source}`);
            return false;
        }

        let isValid = true;
        const errors = [];

        // Validate required fields for each source
        switch (source) {
            case 'vllm':
                if (!this.settings.vllm_model) {
                    errors.push('vLLM model name is required');
                    isValid = false;
                }
                break;
            case 'ollama':
                if (!this.settings.ollama_model) {
                    errors.push('Ollama model name is required');
                    isValid = false;
                }
                break;
            // Transformers doesn't require specific validation
        }

        // Validate numerical parameters
        if (this.settings.chunk_size < 100) {
            errors.push('Chunk size must be at least 100');
            isValid = false;
        }

        if (this.settings.overlap_percent < 0 || this.settings.overlap_percent > 50) {
            errors.push('Overlap percentage must be between 0 and 50');
            isValid = false;
        }

        if (this.settings.score_threshold < 0 || this.settings.score_threshold > 1) {
            errors.push('Score threshold must be between 0 and 1');
            isValid = false;
        }

        if (errors.length > 0) {
            console.warn('VectorizationSettings: Validation errors:', errors);
        }

        return isValid;
    }

    /**
     * Save settings using ConfigManager
     */
    saveSettings() {
        if (this.configManager) {
            // ConfigManager will handle the actual saving
            console.debug('VectorizationSettings: Settings saved via ConfigManager');
        } else {
            console.warn('VectorizationSettings: No ConfigManager available for saving');
        }
    }

    /**
     * Refresh the component - reload settings and update UI
     */
    async refresh() {
        console.log('VectorizationSettings: Refreshing...');
        this.loadCurrentSettings();
        this.updateSourceVisibility();
        console.log('VectorizationSettings: Refresh completed');
    }

    /**
     * Get current source configuration status
     */
    getSourceStatus() {
        const currentSource = this.settings.source;
        return {
            source: currentSource,
            isValid: this.validateSourceConfig(currentSource),
            config: this.sourceConfigs[currentSource] || null
        };
    }

    /**
     * Get all vectorization settings
     */
    getSettings() {
        return {
            source: this.settings.source,
            local_model: this.settings.local_model,
            vllm_model: this.settings.vllm_model,
            vllm_url: this.settings.vllm_url,
            ollama_model: this.settings.ollama_model,
            ollama_url: this.settings.ollama_url,
            ollama_keep: this.settings.ollama_keep,
            chunk_size: this.settings.chunk_size,
            overlap_percent: this.settings.overlap_percent,
            score_threshold: this.settings.score_threshold,
            force_chunk_delimiter: this.settings.force_chunk_delimiter,
            query_messages: this.settings.query_messages,
            max_results: this.settings.max_results,
            enabled: this.settings.enabled,
            show_query_notification: this.settings.show_query_notification,
            detailed_notification: this.settings.detailed_notification
        };
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        console.log('VectorizationSettings: Destroying...');

        $('#vectors_enhanced_embedding_preset_select').off('change');
        $('#vectors_enhanced_embedding_preset_save').off('click');
        $('#vectors_enhanced_embedding_preset_delete').off('click');

        // Remove event listeners
        $('#vectors_enhanced_source').off('change');

        // Remove source-specific listeners
        Object.entries(this.sourceConfigs).forEach(([source, config]) => {
            config.fields.forEach(field => {
                $(`#vectors_enhanced_${field}`).off('input change');
            });
        });

        // Remove parameter listeners
        const parameters = [
            'chunk_size', 'overlap_percent', 'score_threshold', 'force_chunk_delimiter',
            'query_messages', 'max_results', 'enabled', 'show_query_notification', 'detailed_notification'
        ];

        parameters.forEach(param => {
            $(`#vectors_enhanced_${param}`).off('input change');
        });

        this.initialized = false;
        console.log('VectorizationSettings: Destroyed');
    }
}

// Helper methods from InjectionSettings.js
Object.assign(VectorizationSettings.prototype, {
    updatePositionVisibility() {
        const position = this.settings.position;
        const depthControls = $('#vectors_enhanced_depth_controls');
        if (position === 1) { // at_depth
            depthControls.show();
        } else {
            depthControls.hide();
        }
        console.log(`VectorizationSettings: Updated position visibility (position: ${position})`);
    },

    validateTemplate(template) {
        const errors = [];
        let isValid = true;
        if (!template || template.trim() === '') {
            errors.push('Injection template cannot be empty');
            isValid = false;
        } else if (!template.includes('{{text}}')) {
            errors.push('Template must contain {{text}} placeholder');
            isValid = false;
        }
        if (errors.length > 0) {
            this.showTemplateErrors(errors);
        } else {
            this.clearTemplateErrors();
        }
        return isValid;
    },

    showTemplateErrors(errors) {
        let errorContainer = $('#vectors_enhanced_template_errors');
        if (errorContainer.length === 0) {
            errorContainer = $('<div>', {
                id: 'vectors_enhanced_template_errors',
                class: 'text-danger m-t-0-5',
                style: 'font-size: 0.9em;'
            });
            $('#vectors_enhanced_template').after(errorContainer);
        }
        const errorHtml = errors.map(error => `<div>• ${error}</div>`).join('');
        errorContainer.html(`<strong>模板错误:</strong>${errorHtml}`).show();
    },

    clearTemplateErrors() {
        $('#vectors_enhanced_template_errors').hide();
    }
});
