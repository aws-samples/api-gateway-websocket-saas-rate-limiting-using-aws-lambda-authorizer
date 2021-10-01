// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");

exports.handler = async(event, context) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        if (event.requestContext.http.method == "GET") {
            event.queryStringParameters = {
                tenantId: "none"
            };
            let dynamo = exports.createDynamoDBClient(event);
            let body = await dynamo.scan({ "TableName": process.env.TenantTableName }).promise();
            return {statusCode: 200, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
        }
    }
    catch (err) {
        console.log('Error:', JSON.stringify(err, null, 2));
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
}

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

let generatePolicy = function(effect, resource, event) {
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
        sessionId: exports.getSessionId(event)
    };
    return authResponse;
}
exports.generateAllow = function(resource, event) { return generatePolicy('Allow', resource, event); }
exports.generateDeny = function(resource, event) { return generatePolicy('Deny', resource, event); }