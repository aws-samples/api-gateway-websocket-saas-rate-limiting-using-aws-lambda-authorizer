// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const common = require("./Common.js");
const apig = new AWS.ApiGatewayManagementApi({ endpoint: process.env.ApiGatewayEndpoint });
const TTL = 60 * 5; // Set TTL for 5 mins

exports.handler = async (event, context) => {
    //console.log("Event: ", JSON.stringify(event, null, 2));
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
            }
            let queueName = event.Records[r].eventSourceARN.substring(event.Records[r].eventSourceARN.indexOf("tenant-"), event.Records[r].eventSourceARN.length);
            try {
                let body = recordEvent.body;
                let connectionId = recordEvent.connectionId;
                let requestId = recordEvent.requestId;
                let tenantId = common.getTenantId(recordEvent);
                let sessionId = common.getSessionId(recordEvent);
                let dynamo = common.createDynamoDBClient(recordEvent);
                // Update and check the total number of messages per minute per tenant
                let updateResponse = await common.incrementLimitTablePerMinute(dynamo, tenantId, "minutemsg");
                if (!updateResponse || updateResponse.Attributes.itemCount > recordEvent.requestContext.authorizer.messagesPerMinute) {
                    console.log("Tenant: " + tenantId + " message rate limit hit");
                    await apig.postToConnection({ ConnectionId: connectionId, Data: common.createMessageThrottleResponse(connectionId, requestId) }).promise();
                    continue;
                }

                var updateParams = {
                    "TableName": process.env.SessionTableName,
                    "Key": { tenantId: tenantId, sessionId: sessionId },
                    "UpdateExpression": "set sessionTTL = :ttl",
                    "ExpressionAttributeValues": {
                        ":ttl": (Math.floor(+new Date() / 1000) + parseInt(recordEvent.requestContext.authorizer.sessionTTL))
                    },
                    "ReturnValues": "ALL_OLD"
                };
                let results = await dynamo.update(updateParams).promise();
                let connectionIds = results.Attributes.connectionIds.values;
                for (var x = 0; x < connectionIds.length; x++) {
                    if (connectionIds[x] != connectionId) {
                        await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `${body}` }).promise();
                    }
                }
                let response = {

                };
                for (var x = 0; x < connectionIds.length; x++) {
                    await apig.postToConnection({ ConnectionId: connectionIds[x], Data: common.createEchoResponse(tenantId, sessionId, connectionIds[x], body, queueName) }).promise();
                }
            }
            catch (err) {
                console.log("Error: " + JSON.stringify(err, null, 2));
                return { statusCode: 1011 }; // return server error code
            }
        }
    }
    const response = {
        statusCode: 200
    };
    return response;
};
