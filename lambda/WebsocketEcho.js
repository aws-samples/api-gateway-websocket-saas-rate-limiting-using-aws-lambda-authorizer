// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const common = require("./Common.js");
const apig = new ApiGatewayManagementApiClient({ endpoint: "https://" + process.env.ApiGatewayEndpoint });

/// This sample file is currently NOT used in this sample but is given as an example of executing a Lambda directly vs using SQS

exports.handler = async function(event, context) {
    const {body, requestContext: {connectionId, routeKey, requestId}} = event;
    if (routeKey == '$default') {
        try {
            let tenantId = common.getTenantId(event);
            let sessionId = common.getSessionId(event);
            let dynamo = common.createDynamoDBClient(event);

            let updateResponse = await common.incrementLimitTablePerMinute(dynamo, tenantId, tenantId, "minutemsg");
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.messagesPerMinute) {
                console.log("Tenant: " + tenantId + " message rate limit hit");
                await apig.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: common.createMessageThrottleResponse(connectionId, requestId) }));
                return { statusCode: 429 };
            }

            let results = await dynamo.send(new common.UpdateCommand({
                TableName: process.env.SessionTableName,
                Key: { tenantId, sessionId },
                UpdateExpression: "set sessionTTL = :ttl",
                ExpressionAttributeValues: { ":ttl": (Math.floor(+new Date() / 1000) + parseInt(event.requestContext.authorizer.sessionTTL)) },
                ReturnValues: "ALL_OLD"
            }));
            let connectionIds = [...results.Attributes.connectionIds];
            for (let x = 0; x < connectionIds.length; x++) {
                if (connectionIds[x] != connectionId) {
                    await apig.send(new PostToConnectionCommand({ ConnectionId: connectionIds[x], Data: `${body}` }));
                }
            }
            for (let x = 0; x < connectionIds.length; x++) {
                await apig.send(new PostToConnectionCommand({ ConnectionId: connectionIds[x], Data: common.createEchoResponse(tenantId, sessionId, connectionIds[x], body, undefined) }));
            }
        } catch (err) {
            console.error(err);
            return { statusCode: 1011 };
        }
    } else {
        return { statusCode: 1008 };
    }
    return { statusCode: 200 };
}
