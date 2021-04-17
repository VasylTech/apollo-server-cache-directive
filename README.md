# Apollo Server Cache Directive

<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#motivation">Motivation</a>
    </li>
    <li>
      <a href="#objectives">Objectives</a>
    </li>
    <li>
      <a href="#installation">Installation</a>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#directive-arguments">Directive Arguments</a></li>
    <li><a href="#understanding-cachekey-argument">Understanding cacheKey Argument</a></li>
    <li><a href="#cache-types">Cache Types</a></li>
    <li><a href="#sample-project">Sample Project</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- MOTIVATION -->
## Motivation

It appears that the Apollo GraphQL server is lacking a simple distributed caching mechanism on a field level. In-depth search for existing solutions narrows down to 2 NPM packages [apollo-cache-control](https://www.npmjs.com/package/apollo-cache-control) and [apollo-server-cache-redis](https://www.npmjs.com/package/apollo-server-cache-redis).

- The "apollo-cache-control", based on the [documentation on the official ApolloGraphQL website](https://www.apollographql.com/docs/apollo-server/performance/caching/), is designed to emit only cache-control HTTP headers so any caching proxy or CDN can manage the actual response caching.
- The "apollo-server-cache-redis" caches in Redis only the final response (after all fields have been resolved).

Neither package allows defining granular cache behavior on individual fields or queries, so that motivated me to quickly put together this package.


<!-- OBJECTIVE -->
## Objectives

Ability to cache any field value either in memory or in distributed cache storage with a simple `@cache` directive.

```graphql
type Library {
  id: ID!,
  books(type: String): [Book] @cache(ttl: 300)
}
```

In the example above, the `books` field is cached for 5 minutes for each library.

Additionally, prevent from resolving cachable fields when multiple parallel requests are sent to fetch the same data. In the sample GraphQL schema above, the `books` field is cachable. When multiple parallel requests are sent to fetch books for the same library, the first request triggers the `books` resolver. Other requests will wait for the first resolver to complete the execution. This way, if there is no cache for books, the server will not try to resolve the same `books` field for all parallel requests at the same time.


<!-- INSTALLATION -->
## Installation

```sh
npm install apollo-server-cache-directive
```


<!-- USAGE EXAMPLES -->
## Usage

The `apollo-server-cache-directive` is a simple wrapper for the [ApolloServer](https://github.com/apollographql/apollo-server) that extends your GraphQL schema with an additional `@cache` directive.

It does not declare new cache storage. So this is up to you to decide [what cache storage to use](https://www.apollographql.com/docs/apollo-server/performance/caching/) as long as it implements the [KeyValueCache](https://github.com/apollographql/apollo-server/blob/main/packages/apollo-server-caching/src/KeyValueCache.ts) interface.

> FYI! If no cache is defined during ApolloServer instantiation, then the default [in-memory cache](https://www.apollographql.com/docs/apollo-server/performance/caching/#in-memory-cache-setup) will be used.

Import the `ApolloServerConfigWrapper` function into your project and while creating a new `ApolloServer` instance, wrap the config in the imported function.

```js
const { ApolloServerConfigWrapper } = require('apollo-server-cache-directive');

//...

const server = new ApolloServer(ApolloServerConfigWrapper({
  typeDefs,
  resolvers,
  cache: new RedisCache({
    host: 'localhost'
  })
}));
```

As you've noticed, in the example above I'm using distributed Redis cache instance.


<!-- DIRECTIVE ARGUMENTS -->
## Directive Arguments

Directive definition:
```graphql
directive @cache(ttl: Int, cacheKey: String, type: CacheType, pollingTimeout: Int, pingInterval: Int) on FIELD_DEFINITION
```

| Argument | Description |
| --- | --- |
| ttl | `Number`: Number of seconds the fields should be cached for. Default is `900` seconds. |
| cacheKey | `String`: Comma-separated list of of attributes that define unique cached key. Check <a href="#understanding-cachekey-argument">Understanding cacheKey Argument</a> section for more info. Default is `parent,args,vars`. |
| type | `CacheType`: How the cache is resolved. The allowed values are `SHARED` and `SCOPED`. For more information, refer to the <a href="#cache-types">Cache types</a> section. Default is `SHARED`. |
| pollingTimeout | `Number`: Number of seconds the resolve is allowed to try to fetch the data before returning `null` value. Default is `30` seconds. |
| pingInterval | `Number`: When other resolver is already fetching requested data, then how frequent (in milliseconds) the current resolver should check if the first resolver already finished execution. Default is `1000` milliseconds. |

<!-- UNDERSTANDING CACHEKEY ARGUMENT -->
## Understanding cacheKey Argument

**cacheKey** argument syntax:
 - `parent.<field-name>`
 - `args.<argument-name>`
 - `vars.<variable-name>`

The cache is defined by key/value pair. Where "key" is some unique identify for the "value" that is stored in cache. That is why it is your responsibility to define how the uniqueness of cached data is determined. This way, if next time somebody is requesting the same data, the system will know which "key" to use to check if cache is already built for it or not.

For example, let's take a simple "customer" object that contains the following data.

```json
{
  "fullname": "John Smith",
  "dob": "1980-01-01",
  "ssn": "809-01-0921",
  "creditReport": {
    //...
  }
}
```

The initial information about customer, like fullname or date of birth, is coming from one database. However, the credit report, requires to send an external API call to consumer reporting agency like Equifax or Experian.

So, when we request information about John, we need to make sure that `creditReport` comes from our internal cache first and if no cache yet built, then pull it from the external API. However, we also have to make sure that we do not fetch wrong cache, so the unique cache key has to be very carefully defined.

In our case, the GraphQL schema for the "consumer" type can be defined as following:

```graphql
type Consumer {
  fullname: String!
  dob: String!
  ssn: String!
  creditReport: CreditReport @cache(ttl: 2592000, cacheKey: "parent.dob,parent.ssn")
}
```

The credit report will be cached for each unique combination of `dob` and `ssn`. Below, I'm explaining it a bit more detail about Apollo GraphQL resolver and how its arguments contribute for the cache key computation.

Each resolver can optionally accept [four positional arguments](https://www.apollographql.com/docs/apollo-server/data/resolvers/#resolver-arguments) `(parent, args, context, info)` that contain enough information for us to define a cache key.

For example in the GraphQL query below, the `books` field will be cached for each unique library ID.

```graphql
query GetLibraryBooks {
  library(id: "1000000120") {
    id
		books {
			title
			author
		}
	}
}
```

Below is the schema that supports the query above.

```graphql
type Query {
  library(id: ID!): Library
}

type Library {
  id: ID!,
  books(type: String): [Book] @cache(ttl: 300, cacheKey: "parent.id")
}

type Book {
    title: String
    author: String
}
```

The `parent` argument that is passed to the resolver, already contains the `Library` object type with populated `id` property.

Similar way, we can declare how to define a unique cache key based on passing query [arguments](https://graphql.org/learn/queries/#fields) or [variables](https://graphql.org/learn/queries/#fields).

<!-- CACHE TYPES -->
## Cache types

Currently this package supports two different cache type behaviors. The `SHARED` cache type defines the behavior where the first request to fetch some specific data, sets the indicator that "fetching is in progress", so other parallel requests to fetch exactly the same data will wait until the first resolver is done.

The `SCOPED` cache type will not bother to communicate to other parallel requests about already fetching data. So, if no cache is defined, each resolver will try to fetch the data independently and cache it.

The best way to determine which type of cache to use is to answer the question "Does it takes a lot of time and resources to resolve the field?". If the answer is yes, then stick with `SHARED` type (which is the default). Otherwise, use `SCOPED`.


<!-- SAMPLE PROJECT -->
## Sample Project

There is a sample project included in this repository in the `/sample` folder. To run the project, follow these steps:

1. `npm install & node .`

2. Send GraphQL query request to the `http://localhost:4000/graphql` endpoint:
```graphql
query GetLibrary {
    library(id: "12345") {
        id
        books {
            title
        }
    }
}
```

The `books` resolver is throttled on purpose to show that any parallel requests that ask for the same library details, will wait until the first resolver finish execution.

You can open the Redis [Medis](https://github.com/luin/medis) to observe the behavior of the cache key.

<!-- ROADMAP -->
## Roadmap

See the [open issues](https://github.com/VasylTech/apollo-server-cache-directive/issues) for a list of proposed features (and known issues).


<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to be learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request


<!-- LICENSE -->
## License

Distributed under the Apache License 2.0. See `LICENSE` for more information.


<!-- CONTACT -->
## Contact

Vasyl Martyniuk - [LinkedIn](https://www.linkedin.com/in/vasyltech) - vasyl@vasyltech.com