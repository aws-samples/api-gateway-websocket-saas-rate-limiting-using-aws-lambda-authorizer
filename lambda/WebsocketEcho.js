// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const tenant = require("./Tenant.js");
const apig = new AWS.ApiGatewayManagementApi({ endpoint: process.env.ApiGatewayEndpoint });
const TTL = 60 * 5; // Set TTL for 5 mins

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    const {body, requestContext: {connectionId, routeKey}} = event;
    if (routeKey == '$default') {
        try {
            let dynamo = tenant.createDynamoDBClient(event);
            let tenantId = tenant.getTenantId(event);
            let sessionId = tenant.getSessionId(event);
            var updateParams = {
                "TableName": process.env.SessionTableName,
                "Key": {tenantId: tenantId, sessionId: sessionId},
                "UpdateExpression": "set sessionTTL = :ttl",
                "ExpressionAttributeValues": {
                    ":ttl": (Math.floor(+new Date() / 1000) + TTL)
                },
                "ReturnValues": "ALL_OLD"
            };
            let results = await dynamo.update(updateParams).promise();
            let connectionIds = results.Attributes.connectionIds.values;
            for (var x = 0; x < connectionIds.length; x++) {
                if (connectionIds[x] != connectionId) {
                    await apig.postToConnection({ConnectionId: connectionIds[x], Data: `${body}`}).promise();
                }
            }
            for (var x = 0; x < connectionIds.length; x++) {
                await apig.postToConnection({
                    ConnectionId: connectionIds[x],
                    Data: `Echo Tenant: ${tenantId} Session: ${sessionId}: ${body}`
                }).promise();
            }
        } catch (err) {
            console.log("Error: " + JSON.stringify(err));
            return {statusCode: 1011}; // return server error code
        }
    } else {
        return {statusCode: 1008}; // return policy violation code
    }
    return {statusCode: 200};
}
