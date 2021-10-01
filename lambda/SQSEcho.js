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
                    }
                },
                connectionId: event.Records[r].messageAttributes.connectionId.stringValue,
                body: event.Records[r].body
            }
            let queueName = event.Records[r].eventSourceARN.substring(event.Records[r].eventSourceARN.indexOf("tenant-"), event.Records[r].eventSourceARN.length);

            try {
                let body = recordEvent.body;
                let connectionId = recordEvent.connectionId;
                let dynamo = tenant.createDynamoDBClient(recordEvent);
                let tenantId = tenant.getTenantId(recordEvent);
                let sessionId = tenant.getSessionId(recordEvent);
                var updateParams = {
                    "TableName": process.env.SessionTableName,
                    "Key": { tenantId: tenantId, sessionId: sessionId },
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
                        await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `${body}` }).promise();
                    }
                }
                for (var x = 0; x < connectionIds.length; x++) {
                    await apig.postToConnection({ ConnectionId: connectionIds[x], Data: `Echo Tenant: ${tenantId} Session: ${sessionId} Queue: ${queueName}: ${body}` }).promise();
                }
            }
            catch (err) {
                console.log("Error: " + JSON.stringify(err));
                return { statusCode: 1011 }; // return server error code
            }
        }
    }
    const response = {
        statusCode: 200
    };
    return response;
};
