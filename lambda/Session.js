// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async(event, context) => {
    try {
        let tenantId = common.getTenantId(event);
        let sessionId = common.getSessionId(event);
        if (!tenantId || !sessionId) {
            return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify("Invalid request") };
        }

        let dynamo = common.createDynamoDBClient(event);
        let response = await dynamo.send(new common.GetCommand({ TableName: process.env.TenantTableName, Key: { tenantId } }));
        if (!response || !response.Item || !response.Item.tenantId) {
            return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify("Invalid request") };
        }

        if (event.requestContext.http.method == "PUT") {
            let body = await dynamo.send(new common.UpdateCommand({
                TableName: process.env.SessionTableName,
                Key: { tenantId, sessionId },
                UpdateExpression: "SET sessionTTL = :ttl",
                ExpressionAttributeValues: { ":ttl": (Math.floor(+new Date() / 1000) + response.Item.sessionTTL) },
                ReturnValues: "UPDATED_NEW"
            }));
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        } else if (event.requestContext.http.method == "DELETE") {
            let body = await dynamo.send(new common.DeleteCommand({ TableName: process.env.SessionTableName, Key: { tenantId, sessionId } }));
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        }
    }
    catch (err) {
        console.error(err);
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
};
