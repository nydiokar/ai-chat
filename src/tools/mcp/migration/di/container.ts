import { Container } from 'inversify';
import { IMCPClient, IToolManager, IServerManager } from '../interfaces/core.js';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { BaseToolManager } from '../base/base-tool-manager.js';
import { BaseServerManager } from '../base/base-server-manager.js';
import { EnhancedToolsHandler } from '../enhanced/enhanced-tools-handler.js';
import { EnhancedServerManager } from '../enhanced/enhanced-server-manager.js';
import { EnhancedMCPClient } from '../enhanced/enhanced-mcp-client.js';

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
        this.registerClients();
        this.registerToolManagers();
        this.registerServerManagers();
        this.registerFeatureServices();
    }

    private registerClients(): void {
        if (this.hasEnhancedFeatures()) {
            this.container.bind<IMCPClient>('IMCPClient').to(EnhancedMCPClient);
        } else {
            this.container.bind<IMCPClient>('IMCPClient').to(BaseMCPClient);
        }
    }

    private registerToolManagers(): void {
        if (this.hasEnhancedFeatures()) {
            this.container.bind<IToolManager>('IToolManager').to(EnhancedToolsHandler);
        } else {
            this.container.bind<IToolManager>('IToolManager').to(BaseToolManager);
        }
    }

    private registerServerManagers(): void {
        if (this.hasEnhancedFeatures()) {
            this.container.bind<IServerManager>('IServerManager').to(EnhancedServerManager);
        } else {
            this.container.bind<IServerManager>('IServerManager').to(BaseServerManager);
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
        const { enhanced } = this.config.features;
        return Object.values(enhanced).some(value => value === true);
    }

    public getToolManager(): IToolManager {
        return this.container.get<IToolManager>('IToolManager');
    }

    public getMCPClient(): IMCPClient {
        return this.container.get<IMCPClient>('IMCPClient');
    }

    public getServerManager(): IServerManager {
        return this.container.get<IServerManager>('IServerManager');
    }
} 