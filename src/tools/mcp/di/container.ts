import { Container } from 'inversify';
import { IMCPClient, IToolManager, IServerManager } from '../interfaces/core.js';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { BaseToolManager } from '../base/base-tool-manager.js';
import { BaseServerManager } from '../base/base-server-manager.js';
import { EnhancedToolsHandler } from '../enhanced/enhanced-tools-handler.js';
import { EnhancedServerManager } from '../enhanced/enhanced-server-manager.js';
import { EnhancedMCPClient } from '../enhanced/enhanced-mcp-client.js';
import { ServerConfig } from '../types/server.js';
import { TYPES } from './types.js';


export interface MCPConfig {
    features: {
        core: {
            serverManagement: true; // Always true as it's core
            toolOperations: true;   // Always true as it's core
            clientCommunication: true; // Always true as it's core
        };
        enhanced: {
            analytics: boolean;
            contextManagement: boolean;
            caching: boolean;
            stateManagement: boolean;
            healthMonitoring: boolean;
        };
        enterprise?: {
            persistence: boolean;
            loadBalancing: boolean;
            advancedAnalytics: boolean;
            monitoring: boolean;
            recovery: boolean;
        };
    };
    mcpServers: Record<string, ServerConfig>;
}

export class MCPContainer {
    private container: Container;
    private config: MCPConfig;

    constructor(config: MCPConfig) {
        this.container = new Container();
        this.config = config;
        this.configureContainer();
    }

    private configureContainer(): void {
        // Bind container instance
        this.container.bind<Container>('Container').toConstantValue(this.container);
        
        this.registerClients();
        this.registerToolManagers();
        this.registerServerManagers();
        this.registerFeatureServices();
    }

    private registerClients(): void {
        // Create a map to store clients for each server
        const clientsMap = new Map<string, string>();
        const serverConfigs = new Map<string, ServerConfig>();

        // Create a client for each server
        for (const [serverId, serverConfig] of Object.entries(this.config.mcpServers)) {
            // Create unique identifier for this client
            const clientId = `IMCPClient_${serverId}`;

            // Create the client instance
            const clientInstance = this.hasEnhancedFeatures() 
                ? new EnhancedMCPClient(serverConfig, serverId)
                : new BaseMCPClient(serverConfig, serverId);

            // Bind the client with its unique ID
            this.container.bind<IMCPClient>(clientId).toConstantValue(clientInstance);

            // Store the client ID and config for later use
            clientsMap.set(serverId, clientId);
            serverConfigs.set(serverId, serverConfig);
        }

        // Bind the maps for use by other services
        this.container.bind<Map<string, string>>('ClientsMap')
            .toConstantValue(clientsMap);
        this.container.bind<Map<string, ServerConfig>>('ServerConfigs')
            .toConstantValue(serverConfigs);
    }

    private registerToolManagers(): void {
        if (this.hasEnhancedFeatures()) {
            this.container.bind<IToolManager>(TYPES.IToolManager).to(EnhancedToolsHandler).inSingletonScope();
        } else {
            this.container.bind<IToolManager>(TYPES.IToolManager).to(BaseToolManager).inSingletonScope();
        }
    }

    private registerServerManagers(): void {
        if (this.hasEnhancedFeatures()) {
            this.container.bind<IServerManager>(TYPES.IServerManager).to(EnhancedServerManager).inSingletonScope();
        } else {
            this.container.bind<IServerManager>(TYPES.IServerManager).to(BaseServerManager).inSingletonScope();
        }
    }

    private registerFeatureServices(): void {
        if (this.config.features.enhanced.caching) {
            this.container.bind('CacheManager').toSelf();
        }
        if (this.config.features.enhanced.analytics) {
            this.container.bind('AnalyticsManager').toSelf();
        }
        if (this.config.features.enhanced.healthMonitoring) {
            this.container.bind('HealthMonitor').toSelf();
        }
        if (this.config.features.enhanced.stateManagement) {
            this.container.bind('StateManager').toSelf();
        }
    }

    private hasEnhancedFeatures(): boolean {
        return Object.values(this.config.features.enhanced).some(enabled => enabled);
    }

    public getToolManager(): IToolManager {
        return this.container.get<IToolManager>(TYPES.IToolManager);
    }

    // Remove the ambiguous getMCPClient overloads and replace with a single method
    public getMCPClient(serverId: string): IMCPClient {
        const clientsMap = this.container.get<Map<string, string>>('ClientsMap');
        const clientId = clientsMap.get(serverId);
        if (!clientId) {
            throw new Error(`No client configuration found for server ${serverId}. Available servers: ${Array.from(clientsMap.keys()).join(', ')}`);
        }
        
        return this.container.get<IMCPClient>(clientId);
    }

    public getServerManager(): IServerManager {
        return this.container.get<IServerManager>(TYPES.IServerManager);
    }
} 