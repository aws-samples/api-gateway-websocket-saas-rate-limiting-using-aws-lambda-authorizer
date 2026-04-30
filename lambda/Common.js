// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand, ScanCommand, DeleteCommand, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
const { fromTemporaryCredentials } = require("@aws-sdk/credential-providers");

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

// During the creation of the DynamoDB connection the tenant Id is added as the transitive tag key
// to make sure we can only access data for this specific tenant
exports.createDynamoDBClient = function(event) {
    const credentials = fromTemporaryCredentials({
        params: {
            RoleArn: process.env.RoleArn,
            RoleSessionName: "lambda-session",
            Tags: [{ Key: "tenantId", Value: exports.getTenantId(event) }],
            TransitiveTagKeys: ["tenantId"]
        }
    });
    const ddbClient = new DynamoDBClient({ credentials });
    return DynamoDBDocumentClient.from(ddbClient, {
        marshallOptions: { convertClassInstanceToMap: true }
    });
}

exports.incrementLimitTablePerMinute = async function(dynamo, tenantId, keyStart, keyMid) {
    const epoch = exports.seconds_since_epoch();
    const currentMin = Math.trunc(epoch / exports.secondsPerMinute) * exports.secondsPerMinute;
    const key = keyStart + ":" + keyMid + ":" + currentMin;
    const params = {
        TableName: process.env.LimitTableName,
        Key: { tenantId, key },
        UpdateExpression: "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
        ExpressionAttributeValues: { ":ttl": currentMin + exports.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
        ReturnValues: "UPDATED_NEW"
    };
    return dynamo.send(new UpdateCommand(params));
}

exports.seconds_since_epoch = function() {
    return Math.floor(Date.now() / 1000);
}

exports.createMessageThrottleResponse = function(connectionId, requestId) {
    return JSON.stringify({ message: "Too Many Requests", connectionId, requestId });
}

exports.createEchoResponse = function(tenantId, sessionId, connectionId, message, queue) {
    const response = { message: JSON.parse(message), tenantId, sessionId, connectionId };
    if (queue) response.queue = queue;
    return JSON.stringify(response);
}

let generatePolicy = function(effect, resource, event, tenantSettings) {
    let authResponse = { principalId: 'anonymous' };
    if (effect && resource) {
        authResponse.policyDocument = {
            Version: '2012-10-17',
            Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }]
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

// Export command classes for use in other modules
exports.GetCommand = GetCommand;
exports.ScanCommand = ScanCommand;
exports.UpdateCommand = UpdateCommand;
exports.DeleteCommand = DeleteCommand;
exports.TransactWriteCommand = TransactWriteCommand;
