import * as crypto from 'crypto';
import { SchemaDirectiveVisitor } from 'graphql-tools';
import { defaultFieldResolver } from 'graphql';
import { KeyValueCache } from 'apollo-server-caching';

class CacheDirective extends SchemaDirectiveVisitor {

    static cache: KeyValueCache;

    static getDirectiveArgumentByName(directive: any, name: string, def: any = null) {
        let result = def;

        const arg = directive.arguments.filter(
            (a: any) => a.kind === 'Argument' && a.name.value === name
        ).shift();

        if (typeof arg !== 'undefined') {
            const val = arg.value;

            if (val.kind === 'ListValue') {
                result = [];
                val.values.forEach((v: any) => result.push(v.value));
            } else {
                result = val.kind === 'IntValue' ? parseInt(val.value) : val.value;
            }
        }

        return result;
    }

    static getCacheDirective(field: any) {
        return field.astNode.directives.filter(
            (d: any) => d.kind === 'Directive' && d.name.value === 'cache'
        ).shift();
    }

    static hasCacheDirective(field: any) {
        return typeof CacheDirective.getCacheDirective(field) !== 'undefined';
    }

    async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async readFromCache(directive: any, key: string): any {
        let result;

        let c = await CacheDirective.cache.get(key);

        if (c) {
            const cun = JSON.parse(c);

            if (cun.status === 'processing') {
                await this.sleep(CacheDirective.getDirectiveArgumentByName(
                    directive, 'pingInterval', 1000
                ));
                result = await this.readFromCache(directive, key);
            } else if (cun.status === 'completed') {
                result = cun.value;
            }
        }

        return result;
    }

    static compileCacheKey(directive: any, args: { parent: any, args: any, vars: any }): string {
        let cacheKeys = CacheDirective.getDirectiveArgumentByName(
            directive, 'cacheKey', ['parent', 'args', 'vars']
        );

        if (!Array.isArray(cacheKeys)) {
            cacheKeys = [cacheKeys];
        }

        const combo = Array<any>();

        cacheKeys.forEach((k: string) => {
            const [source, prop] = k.split('.');

            if (typeof prop === 'undefined') {
                combo.push(args[source]);
            } else if (Array('parent', 'args', 'vars').includes(source)) {
                combo.push(args[source][prop]);
            }
        });

        return `ch-${crypto.createHash('md5').update(JSON.stringify(combo)).digest("hex")}`;
    }

    visitFieldDefinition(field: any) {
        const { resolve = defaultFieldResolver } = field;

        field.resolve = async (parent: any, args: any, context: any, info: any) => {
            let result;

            if (CacheDirective.hasCacheDirective(field)) {
                const directive = CacheDirective.getCacheDirective(field);

                const key = CacheDirective.compileCacheKey(
                    directive,
                    { parent, args, vars: info.variableValues }
                );
                const c = await this.readFromCache(directive, key);

                if (!c) {
                    const timeout = CacheDirective.getDirectiveArgumentByName(
                        directive, 'pollingTimeout', 900
                    );
                    const ttl = CacheDirective.getDirectiveArgumentByName(
                        directive, 'ttl', 900
                    );

                    await CacheDirective.cache.set(key, JSON.stringify({
                        status: 'processing'
                    }), { ttl: timeout });

                    result = await resolve.apply(this, [parent, args, context, info]);

                    await CacheDirective.cache.set(key, JSON.stringify({
                        status: 'completed',
                        value: result
                    }), { ttl });
                } else {
                    result = c;
                }
            } else {
                result = await resolve.apply(this, args);
            }

            return result;
        };
    }
}

export default CacheDirective;