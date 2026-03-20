import { MetadataStore } from '../storage/metadata-store.js';

export function createRulesResourceHandler(store: MetadataStore) {
  return {
    list: async () => {
      const rules = await store.getAllRules();
      
      return rules.map(rule => ({
        uri: `rule://${rule.metadata.scope}/${rule.metadata.project_name || 'global'}/${rule.id}`,
        name: `${rule.metadata.scope}: ${rule.title}`,
        description: rule.description.substring(0, 100),
        mimeType: 'application/json',
      }));
    },

    read: async (uri: string) => {
      // Parse URI: rule://{scope}/{project}/{id}
      const match = uri.match(/^rule:\/\/(\w+)\/([^\/]+)\/(.+)$/);
      if (!match) {
        throw new Error(`Invalid rule URI: ${uri}`);
      }

      const [, scope, projectOrId, id] = match;
      
      // Try to get by ID directly or search
      let rule;
      
      if (projectOrId === 'global' || projectOrId === 'project') {
        // URI is rule://scope/project/id
        rule = await store.getRule(id);
      } else {
        // Try as project name
        rule = await store.getRule(projectOrId);
        if (!rule) {
          rule = await store.getRule(id);
        }
      }

      if (!rule) {
        throw new Error(`Rule not found: ${uri}`);
      }

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(rule, null, 2),
        }],
      };
    },
  };
}

export function createPromptsHandler(getContext: () => Promise<string>) {
  return {
    list: async () => [
      {
        name: 'coding-with-rules',
        description: 'Start a coding session with relevant project-specific rules',
        arguments: [
          {
            name: 'project_name',
            description: 'Name of the project',
            required: false,
          },
          {
            name: 'tech_stack',
            description: 'Comma-separated tech stack (e.g., typescript,ocpp)',
            required: false,
          },
          {
            name: 'current_file',
            description: 'Current file being edited',
            required: false,
          },
        ],
      },
    ],

    get: async (name: string, args?: Record<string, string>) => {
      if (name !== 'coding-with-rules') {
        throw new Error(`Unknown prompt: ${name}`);
      }

      const context = await getContext();

      const systemMessage = `You are a coding assistant. Follow these project-specific rules when providing code examples:

${context}

If a rule conflicts with best practices or the user's intent, follow the user's intent and note the conflict.`;

      return {
        messages: [
          {
            role: 'user',
            content: `Starting coding session${args?.project_name ? ` for project: ${args.project_name}` : ''}.
Current file: ${args?.current_file || 'not specified'}
Tech stack: ${args?.tech_stack || 'not specified'}`,
          },
        ],
      };
    },
  };
}
