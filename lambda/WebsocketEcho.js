// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const common = require("./Common.js");
const apig = new AWS.ApiGatewayManagementApi({ endpoint: process.env.ApiGatewayEndpoint });

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    const {body, requestContext: {connectionId, routeKey, requestId}} = event;
    if (routeKey == '$default') {
        try {
            let tenantId = common.getTenantId(event);
            let sessionId = common.getSessionId(event);
            let dynamo = common.createDynamoDBClient(event);

            // Update and check the total number of messages per minute per tenant
            var epoch = common.seconds_since_epoch();
            let currentMin = (Math.trunc(epoch / common.secondsPerMinute) * common.secondsPerMinute);
            let key = tenantId + ":minutemsg:" + currentMin;
            var updateParams = {
                "TableName": process.env.LimitTableName,
                "Key": { key: key },
                "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
                "ExpressionAttributeValues": { ":ttl": currentMin + common.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
                "ReturnValues": "UPDATED_NEW"
            };
            let updateResponse = await dynamo.update(updateParams).promise();
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.messagesPerMinute) {
                console.log("Tenant: " + tenantId + " message rate limit hit");
                await apig.postToConnection({ ConnectionId: connectionId, Data: common.createMessageThrottleResponse(connectionId, requestId) }).promise();
                return {statusCode: 429};
            }

            var updateParams = {
                "TableName": process.env.SessionTableName,
                "Key": {tenantId: tenantId, sessionId: sessionId},
                "UpdateExpression": "set sessionTTL = :ttl",
                "ExpressionAttributeValues": {
                    ":ttl": (Math.floor(+new Date() / 1000) + event.requestContext.authorizer.sessionTTL)
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
                await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `Echo Tenant: ${tenantId} Session: ${sessionId}: ${body}` }).promise();
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
