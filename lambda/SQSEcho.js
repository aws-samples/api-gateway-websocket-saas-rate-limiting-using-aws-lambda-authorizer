// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const common = require("./Common.js");
const apig = new ApiGatewayManagementApiClient({ endpoint: "https://" + process.env.ApiGatewayEndpoint });

exports.handler = async (event, context) => {
    if (event.Records) {
        for (let r = 0; r < event.Records.length; r++) {
            let recordEvent = {
                requestContext: {
                    authorizer: {
                        tenantId: event.Records[r].messageAttributes.tenantId.stringValue,
                        sessionId: event.Records[r].messageAttributes.sessionId.stringValue,
                        messagesPerMinute: event.Records[r].messageAttributes.messagesPerMinute.stringValue,
                        sessionTTL: event.Records[r].messageAttributes.sessionTTL.stringValue
                    }
                },
                connectionId: event.Records[r].messageAttributes.connectionId.stringValue,
                requestId: event.Records[r].messageAttributes.requestId.stringValue,
                body: event.Records[r].body
            };
            let queueName = event.Records[r].eventSourceARN.substring(event.Records[r].eventSourceARN.indexOf("tenant-"));
            try {
                let body = recordEvent.body;
                let connectionId = recordEvent.connectionId;
                let requestId = recordEvent.requestId;
                let tenantId = common.getTenantId(recordEvent);
                let sessionId = common.getSessionId(recordEvent);
                let dynamo = common.createDynamoDBClient(recordEvent);

                let updateResponse = await common.incrementLimitTablePerMinute(dynamo, tenantId, tenantId, "minutemsg");
                if (!updateResponse || updateResponse.Attributes.itemCount > recordEvent.requestContext.authorizer.messagesPerMinute) {
                    console.log("Tenant: " + tenantId + " message rate limit hit");
                    await apig.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: common.createMessageThrottleResponse(connectionId, requestId) }));
                    continue;
                }

                let results = await dynamo.send(new common.UpdateCommand({
                    TableName: process.env.SessionTableName,
                    Key: { tenantId, sessionId },
                    UpdateExpression: "set sessionTTL = :ttl",
                    ExpressionAttributeValues: { ":ttl": (Math.floor(+new Date() / 1000) + parseInt(recordEvent.requestContext.authorizer.sessionTTL)) },
                    ReturnValues: "ALL_OLD"
                }));
                let connectionIds = [...results.Attributes.connectionIds];
                for (let x = 0; x < connectionIds.length; x++) {
                    if (connectionIds[x] != connectionId) {
                        await apig.send(new PostToConnectionCommand({ ConnectionId: connectionIds[x], Data: `${body}` }));
                    }
                }
                for (let x = 0; x < connectionIds.length; x++) {
                    await apig.send(new PostToConnectionCommand({ ConnectionId: connectionIds[x], Data: common.createEchoResponse(tenantId, sessionId, connectionIds[x], body, queueName) }));
                }
            }
            catch (err) {
                console.error(err);
                return { statusCode: 1011 };
            }
        }
    }
    return { statusCode: 200 };
};
