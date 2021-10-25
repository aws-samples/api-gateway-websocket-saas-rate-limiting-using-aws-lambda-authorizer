// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");

exports.secondsPerMinute = 60;

// Encapsulating the two ways in which we can access a tenant Id depending on if the system has already been authorized 
exports.getTenantId = function(event) {
    if (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.tenantId) {
        return event.requestContext.authorizer.tenantId;
    } else if (event.queryStringParameters && event.queryStringParameters.tenantId) {
        return event.queryStringParameters.tenantId;
    }
    return undefined;
}

// Encapsulating the two ways in which we can access a session Id depending on if the system has already been authorized 
exports.getSessionId = function(event) {
    if (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.sessionId) {
        return event.requestContext.authorizer.sessionId;
    } else if (event.queryStringParameters && event.queryStringParameters.sessionId) {
        return event.queryStringParameters.sessionId;
    }
    return undefined;
}

// During the creation of the DynamoBD connection the tenant Id is added as the transitive tag key
// to make sure we can only access data for this specific tenant
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

// Update the limit table by incrementing the itemCount field by 1 for the specified key/current min combo
// this function returns a promise value of the update command
exports.incrementLimitTablePerMinute = function(dynamo, keyStart, keyMid) {
    var epoch = exports.seconds_since_epoch();
    let currentMin = (Math.trunc(epoch / exports.secondsPerMinute) * exports.secondsPerMinute);
    let key = keyStart + ":" + keyMid + ":" + currentMin;
    var updateParams = {
        "TableName": process.env.LimitTableName,
        "Key": { key: key },
        "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
        "ExpressionAttributeValues": { ":ttl": currentMin + exports.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
        "ReturnValues": "UPDATED_NEW"
    };
    return dynamo.update(updateParams).promise();
}

exports.seconds_since_epoch = function() {
    return Math.floor(Date.now() / 1000);
}

exports.createMessageThrottleResponse = function(connectionId, requestId) {
    return JSON.stringify({ message: "Too Many Requests", connectionId: connectionId, requestId: requestId });
}

exports.createEchoResponse = function(tenantId, sessionId, connectionId, message, queue) {
    let response = {
        message: JSON.parse(message),
        tenantId: tenantId,
        sessionId: sessionId,
        connectionId: connectionId,
        queue: queue
    };
    if (queue) {
        response.queue = queue;
    }
    return JSON.stringify(response);
}

// A policy is generated with an effect (Allow/Deny) and the context is filled
// with the tenant and session information
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