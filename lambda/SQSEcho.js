// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const tenant = require("./Tenant.js");
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
                let tenantId = tenant.getTenantId(recordEvent);
                let sessionId = tenant.getSessionId(recordEvent);
                let dynamo = tenant.createDynamoDBClient(recordEvent);
                // Update and check the total number of messages per minute per tenant
                var epoch = tenant.seconds_since_epoch();
                let currentMin = (Math.trunc(epoch / tenant.secondsPerMinute) * tenant.secondsPerMinute);
                let key = tenantId + ":minutemsg:" + currentMin;
                var updateParams = {
                    "TableName": process.env.LimitTableName,
                    "Key": { key: key },
                    "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
                    "ExpressionAttributeValues": { ":ttl": currentMin + tenant.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
                    "ReturnValues": "UPDATED_NEW"
                };
                let updateResponse = await dynamo.update(updateParams).promise();
                if (!updateResponse || updateResponse.Attributes.itemCount > recordEvent.requestContext.authorizer.messagesPerMinute) {
                    console.log("Tenant: " + tenantId + " message rate limit hit");
                    await apig.postToConnection({ ConnectionId: connectionId, Data: tenant.createMessageThrottleResponse(connectionId, requestId) }).promise();
                    continue;
                }

                var updateParams = {
                    "TableName": process.env.SessionTableName,
                    "Key": { tenantId: tenantId, sessionId: sessionId },
                    "UpdateExpression": "set sessionTTL = :ttl",
                    "ExpressionAttributeValues": {
                        ":ttl": (Math.floor(+new Date() / 1000) + recordEvent.requestContext.authorizer.sessionTTL)
                    },
                    "ReturnValues": "ALL_OLD"
                };
                console.log("UpdateParams: ", JSON.stringify(updateParams, null, 2));
                let results = await dynamo.update(updateParams).promise();
                let connectionIds = results.Attributes.connectionIds.values;
                for (var x = 0; x < connectionIds.length; x++) {
                    if (connectionIds[x] != connectionId) {
                        await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `${body}` }).promise();
                    }
                }
                for (var x = 0; x < connectionIds.length; x++) {
                    await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `Echo Tenant: ${tenantId} Session: ${sessionId} Queue: ${queueName}: ${body}` }).promise();
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
