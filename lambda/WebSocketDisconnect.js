// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async function(event, context) {
    if (event.requestContext.routeKey == '$disconnect') {
        try {
            let dynamo = common.createDynamoDBClient(event);
            let tenantId = common.getTenantId(event);
            let sessionId = common.getSessionId(event);
            await dynamo.send(new common.TransactWriteCommand({ TransactItems: [
                { Update: {
                    TableName: process.env.SessionTableName,
                    Key: { tenantId, sessionId },
                    UpdateExpression: "DELETE connectionIds :c",
                    ExpressionAttributeValues: { ":c": new Set([event.requestContext.connectionId]) }
                }},
                { Update: {
                    TableName: process.env.LimitTableName,
                    Key: { tenantId, key: tenantId },
                    UpdateExpression: "set itemCount = if_not_exists(itemCount, :zero) - :dec",
                    ExpressionAttributeValues: { ":dec": 1, ":zero": 0 }
                }}
            ]}));
        } catch (err) {
            console.error(err);
            return { statusCode: 1011 };
        }
    }
    return { statusCode: 200 };
}
