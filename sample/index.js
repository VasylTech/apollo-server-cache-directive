const express                       = require('express');
const { ApolloServer, gql }         = require('apollo-server-express');
const Fs                            = require('fs');
const Db                            = require('./db');
const { RedisCache }                = require('apollo-server-cache-redis');
const { ApolloServerConfigWrapper } = require('apollo-server-cache-directive');

const app = express();

// Define schema
const typeDefs = gql(
    Fs.readFileSync(`${__dirname}/schema.graphql`).toString('utf-8')
);

// Define resolvers
const resolvers = {
    Query: {
        library: (parent, args) => ({ id: args.id })
    },
    Library: {
        books: () => {
            return new Promise(resolve => {
                setTimeout(() => resolve(Db), 10000);
            });
        }
    }
};

// Instantiate the ApolloServer instance and enhance its config with @cache directive
const server = new ApolloServer(ApolloServerConfigWrapper({
    typeDefs,
    resolvers,
    cache: new RedisCache({
        host: 'localhost',
    })
}));

server.applyMiddleware({ app });

// The `listen` method launches a web server.
app.listen({ port: 4000 }, () =>
    console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`)
);