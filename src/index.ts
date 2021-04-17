import gql from 'graphql-tag';
import { InMemoryLRUCache } from 'apollo-server-caching';
import CacheDirective from './cacheDirective';

export function ApolloServerConfigWrapper(config: any) {
    // Declare new cache directive
    const cacheDef = gql(`
        directive @cache(ttl: Int, cacheKey: String, type: CacheType, pollingTimeout: Int, pingInterval: Int) on FIELD_DEFINITION
        enum CacheType {
            SHARED
            SCOPED
        }
    `);

    // Add new cache directive declaration to the schema
    if (typeof config.typeDefs !== 'undefined') {
        if (Array.isArray(config.typeDefs)) {
            config.typeDefs.push(cacheDef);
        } else {
            config.typeDefs = [config.typeDefs, cacheDef];
        }
    }

    if (typeof config.cache === 'undefined') {
        config.cache = new InMemoryLRUCache();
    }

    CacheDirective.cache = config.cache;

    // Register new cache directive
    if (typeof config.schemaDirectives === 'undefined') {
        config.schemaDirectives = {
            cache: CacheDirective
        }
    } else {
        config.schemaDirectives.cache = CacheDirective;
    }

    return config;
}