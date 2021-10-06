// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");
const TTL = 60 * 5; // Set TTL for 5 mins

exports.handler = async(event, context) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        let tenantId = common.getTenantId(event);
        let sessionId = common.getSessionId(event);
        if (!tenantId || !sessionId) {
            return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify("Invalid request") };
        }

        let dynamo = common.createDynamoDBClient(event);
        // Check for a valid tenantId
        let response = await dynamo.get({ "TableName": process.env.TenantTableName, "Key": { tenantId: tenantId } }).promise();
        if (!response || !response.Item || !response.Item.tenantId) {
            return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify("Invalid request") };
        }
        if (event.requestContext.http.method == "PUT") {
            let params = {
                "TableName": process.env.SessionTableName,
                "Key": {
                    "tenantId": tenantId,
                    "sessionId": sessionId,
                },
                "UpdateExpression": "SET sessionTTL = :ttl",
                "ExpressionAttributeValues": {
                    ":ttl": (Math.floor(+new Date() / 1000) + TTL)
                },
                "ReturnValues": "UPDATED_NEW"
            };
            let body = await dynamo.update(params).promise();
            return {statusCode: 200, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
        } else if (event.requestContext.http.method == "DELETE") {
            let params = {
                "TableName": process.env.SessionTableName,
                "Key": { tenantId: tenantId, sessionId: sessionId }
            };
            let body = await dynamo.delete(params).promise();
            return {statusCode: 200, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
        }
    }
    catch (err) {
        console.error(err);
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
};
