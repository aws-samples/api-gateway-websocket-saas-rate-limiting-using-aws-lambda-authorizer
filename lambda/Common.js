// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");

exports.secondsPerMinute = 60;

exports.getTenantId = function(event) {
    if (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.tenantId) {
        return event.requestContext.authorizer.tenantId;
    } else if (event.queryStringParameters && event.queryStringParameters.tenantId) {
        return event.queryStringParameters.tenantId;
    }
    return undefined;
}

exports.getSessionId = function(event) {
    if (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.sessionId) {
        return event.requestContext.authorizer.sessionId;
    } else if (event.queryStringParameters && event.queryStringParameters.sessionId) {
        return event.queryStringParameters.sessionId;
    }
    return undefined;
}

exports.createDynamoDBClient = function(event) {
    var credentials = new AWS.ChainableTemporaryCredentials({
        params: {
            RoleArn: process.env.RoleArn,
            Tags: [{
                Key: "tenantId",
                Value: exports.getTenantId(event)
            }],
            TransitiveTagKeys: [
                "tenantId"
            ]
        },
        Credentials: {
            AccessKeyId: AWS.config.credentials.AccessKeyId,
            SecretAccessKey: AWS.config.credentials.SecretAccessKey,
            SessionToken: AWS.config.credentials.SessionToken
        }
    });
    return new AWS.DynamoDB.DocumentClient(new AWS.Config({
        credentials: credentials
    }));
}

exports.seconds_since_epoch = function() {
    return Math.floor(Date.now() / 1000);
}

exports.createMessageThrottleResponse = function(connectionId, requestId) {
    return JSON.stringify({ message: "Too Many Requests", connectionId: connectionId, requestId: requestId });
}

let generatePolicy = function(effect, resource, event, tenantSettings) {
    // Required output:
    let authResponse = {};
    authResponse.principalId = 'anonymous';
    if (effect && resource) {
        authResponse.policyDocument = {
            Version: '2012-10-17', // default version
            Statement: [{
                Action: 'execute-api:Invoke', // default action
                Effect: effect,
                Resource: resource
            }]
        };
    }
    authResponse.context = {
        tenantId: exports.getTenantId(event),
        sessionId: exports.getSessionId(event),
        sessionPerMinute: tenantSettings ? tenantSettings.sessionPerMinute : -1,
        tenantPerMinute: tenantSettings ? tenantSettings.tenantPerMinute : -1,
        tenantConnections: tenantSettings ? tenantSettings.tenantConnections : -1,
        connectionsPerSession: tenantSettings ? tenantSettings.connectionsPerSession : -1,
        sessionTTL: tenantSettings ? tenantSettings.sessionTTL : -1,
        messagesPerMinute: tenantSettings ? tenantSettings.messagesPerMinute : -1
    };
    return authResponse;
}
exports.generateAllow = function(resource, event, tenantSettings) { return generatePolicy('Allow', resource, event, tenantSettings); }
exports.generateDeny = function(resource, event) { return generatePolicy('Deny', resource, event, null); }