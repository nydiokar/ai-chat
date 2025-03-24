// Resource types for MCP integration
export type Resource = {
    uri: string;
    name: string;
    mimeType?: string;
    description?: string;
};

export type ResourceTemplate = {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
};

export type ResourceResponse = {
    _meta?: Record<string, any>;
    contents: Array<{
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
    }>;
};

export type ResourceQuery = {
    uri?: string;
    name?: string;
    mimeType?: string;
};

export type ResourceCreateParams = {
    uri: string;
    name: string;
    mimeType?: string;
    description?: string;
    content?: string;
};

export type ResourceUpdateParams = {
    name?: string;
    mimeType?: string;
    description?: string;
    content?: string;
}; 