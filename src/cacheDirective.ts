/**
 * Cache Directive class
 *
 * This class hooks into the field resolution process and orchestrate how the cache
 * behaves
 *
 * @module apollo-server-cache-directive
 */

import * as crypto from 'crypto';
import { SchemaDirectiveVisitor } from 'graphql-tools';
import { defaultFieldResolver } from 'graphql';
import { KeyValueCache } from 'apollo-server-caching';
import { GraphQLResolveInfo, DirectiveNode, GraphQLField } from 'graphql';

/**
 * Cache Directive class definition
 *
 * @version 1.0.0
 */
class CacheDirective extends SchemaDirectiveVisitor {

    /**
     * Reference to the cache instance
     *
     * This static property contains the reference to the Apollo Server cache
     * that is provided as `cache` option to the ApolloServer instance.
     *
     * @param cache Instance of the Apollo server cache
     *
     * @version 1.0.0
     */
    static cache: KeyValueCache;

    /**
     * Get @cache directive argument value by its name
     *
     * @param directive [Directive Node]
     * @param name      [Directive's argument name]
     *
     * @returns Argument's value or undefined
     *
     * @version 1.0.0
     */
    getDirectiveArgumentByName(
        directive: DirectiveNode,
        name: string
    ): string | undefined {
        let result;
        let argument;

        // Making sure that our directive contains the array of arguments at all
        if (Array.isArray(directive.arguments)) {
            argument = directive.arguments.filter(
                (a: any) => a.kind === 'Argument' && a.name.value === name
            ).shift();
        }

        if (argument !== undefined && typeof argument.value.value === 'string') {
            result = argument.value.value.trim();
        }

        return result;
    }

    /**
     * Get numeric @cache directive argument value by its name
     *
     * @param directive [Directive Node]
     * @param name      [Directive's argument name]
     * @param def       [Default value if none is declared]
     *
     * @returns Directive's arguments converted to number
     *
     * @version 1.0.0
     */
    getNumericDirectiveArgumentByName(
        directive: DirectiveNode,
        name: string,
        def: number = 0
    ): number {
        const value = this.getDirectiveArgumentByName(directive, name);

        return (value === undefined ? def : parseInt(value, 10));
    }

    /**
     * Get string @cache directive argument value by its name
     *
     * @param directive [Directive Node]
     * @param name      [Directive's argument name]
     * @param def       [Default value if none is declared]
     *
     * @returns Directive's arguments converted to string
     *
     * @version 1.0.0
     */
    getStringDirectiveArgumentByName(
        directive: DirectiveNode,
        name: string,
        def: string = ''
    ): string {
        const value = this.getDirectiveArgumentByName(directive, name);

        return (value === undefined ? def : value.toString());
    }

    /**
     * Get @cache directive if defined
     *
     * @param field GraphQL field data
     *
     * @returns Cache directive or undefined
     *
     * @version 1.0.0
     */
    getCacheDirective(field: GraphQLField<any, any>): DirectiveNode {
        let directive;

        const node = typeof field.astNode !== 'undefined' ? field.astNode : null;

        if (node && Array.isArray(node.directives)) {
            directive = node.directives.filter(
                (d: any) => d.kind === 'Directive' && d.name.value === 'cache'
            ).pop(); // Get the last @cache directive
        }

        return directive;
    }

    /**
     * Check if GraphQL field has @cache directive defined
     *
     * @param field GraphQL field definition
     *
     * @returns Boolean true or false
     *
     * @version 1.0.0
     */
    hasCacheDirective(field: GraphQLField<any, any>): boolean {
        return this.getCacheDirective(field) !== undefined;
    }

    /**
     * Pause the further execution for X milliseconds
     *
     * @param ms [Milliseconds to delay the further execution]
     *
     * @returns Promise to that resolves after specified number of ms
     *
     * @version 1.0.0
     */
    async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Check if cache type is "SHARED"
     *
     * The "SHARED" is the type of cache where the first request will try to resolve
     * the cacheable field, while all other upcoming request for the exactly the same
     * field, will wait until the first resolver is done.
     *
     * @param directive [Cache directive]
     *
     * @returns Boolean true or false
     */
    isSharedCache(directive: DirectiveNode): boolean {
        const type = this.getStringDirectiveArgumentByName(
            directive,
            'type',
            'SHARED'
        );

        return type === 'SHARED';
    }

    /**
     * Check if cache type is "SCOPED"
     *
     * The "SCOPED" is the type of cache where if no cache for the very specific field
     * is identified, then invoke the resolve and fetch it. This means that multiple
     * parallel requests will try to resolve the cacheable fields independently.
     *
     * @param directive [Cache directive]
     *
     * @returns Boolean true or false
     */
    isScopedCache(directive: DirectiveNode): boolean {
        const type = this.getStringDirectiveArgumentByName(
            directive,
            'type',
            'SHARED'
        );

        return type === 'SCOPED';
    }

    /**
     * Read value from the distributed cache source
     *
     * @param directive [@cache directive definition]
     * @param key       [Unique cache key]
     *
     * @returns Value that is fetched from cache
     *
     * @version 1.0.0
     */
    async readFromCache(directive: DirectiveNode, key: string): Promise<any | undefined> {
        let result;

        let cache = await CacheDirective.cache.get(key);

        if (cache !== undefined) {
            const content = JSON.parse(cache);

            // Depending on the type of cache, adjust the behavior accordingly
            if (this.isSharedCache(directive)) {
                if (content.status === 'processing') {
                    await this.sleep(this.getNumericDirectiveArgumentByName(
                        directive, 'pingInterval', 1000
                    ));
                    result = await this.readFromCache(directive, key);
                } else if (content.status === 'completed') {
                    result = content.value;
                }
            } else if (this.isScopedCache(directive)) {
                result = content.value;
            }
        }

        return result;
    }

    /**
     * Build a unique cache key based on the @cache cacheKey argument
     *
     * @param directive [Cache directive]
     * @param parent    [Parent model]
     * @param args      [Field's GraphQL arguments]
     * @param info      [Field's GraphQL info]
     *
     * @returns String e.g `ch-dc780c16ad11300af9127b3a578f3552`
     *
     * @version 1.0.0
     */
    compileCacheKey(
        directive: DirectiveNode,
        parent: any,
        args: {
            [key: string]: any;
        },
        info: GraphQLResolveInfo
    ): string {
        const cacheKeys = this.getStringDirectiveArgumentByName(
            directive, 'cacheKey', 'parent,args,vars'
        ).split(',');

        const combo = Array<any>();

        // Compile the allowed sources
        const sources: Record<string, any> = {
            parent,
            args,
            vars: info.variableValues
        }

        cacheKeys.forEach((k: string) => {
            const [source, prop] = k.split('.', 2);

            // If prop is not defined, then we take the entire source content
            if (prop === undefined) {
                combo.push(sources[source]);
            } else if (Array('parent', 'args', 'vars').includes(source)) {
                combo.push(sources[source][prop]);
            }
        });

        return `ch-${crypto.createHash('md5').update(JSON.stringify(combo)).digest("hex")}`;
    }

    /**
     * Resolve the field's value
     *
     * @param field [GraphQL field definition]
     *
     * @returns Void
     *
     * @version 1.0.0
     */
    visitFieldDefinition(field: GraphQLField<any, any>) {
        const { resolve = defaultFieldResolver } = field;

        field.resolve = async (
            parent: any,
            args: {
                [key: string]: any;
            },
            context: Record<string, any>,
            info: GraphQLResolveInfo
        ) => {
            let result;

            if (this.hasCacheDirective(field)) {
                // Get the @cache directive, because it is clearly declared
                const directive = this.getCacheDirective(field);

                // Compile the unique cache key that is used to store the cache
                const key = this.compileCacheKey(directive, parent, args, info);

                // Read the cache from the distributed cache engine
                const cache = await this.readFromCache(directive, key);

                // Ok, we clearly do not have any cache stored, let's try to
                // resolve it
                if (cache === undefined) {
                    // What is the time-to-life for the cache
                    const ttl = this.getNumericDirectiveArgumentByName(
                        directive, 'ttl', 900
                    );

                    if (this.isSharedCache(directive)) {
                        // The polling timeout is used to set the temporary cache flag
                        // that signals to other resolvers that the first resolver is
                        // already trying to fetch the data, so others can chillout and
                        // wait.
                        const timeout = this.getNumericDirectiveArgumentByName(
                            directive, 'pollingTimeout', 900
                        );

                        // Setting the "polling indicator"
                        await CacheDirective.cache.set(key, JSON.stringify({
                            status: 'processing'
                        }), { ttl: timeout });
                    }

                    // Invoking the original field's resolver to fetch/resolve the
                    // field's value. The resolved value will be cached further
                    result = await resolve.apply(this, [parent, args, context, info]);

                    // Persist the cache in the distributed cache instance, however,
                    // depending on the type of cache, the "shape" may vary
                    let cacheData;

                    if (this.isSharedCache(directive)) {
                        cacheData = {
                            status: 'completed',
                            value: result
                        }
                    } else {
                        cacheData = result;
                    }

                    // Cool, we resolved the field's value, so let's cache it for
                    // defined ttl
                    await CacheDirective.cache.set(
                        key,
                        JSON.stringify(cacheData),
                        { ttl }
                    );
                } else {
                    result = cache;
                }
            } else { // No @cache directive on the field, then resolve as normal
                result = await resolve.apply(this, [parent, args, context, info]);
            }

            return result;
        };
    }

}

export default CacheDirective;