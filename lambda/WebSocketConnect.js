// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async function(event, context) {
    if (event.requestContext.routeKey == '$connect') {
        let dynamo = common.createDynamoDBClient(event);
        let tenantId = common.getTenantId(event);
        let sessionId = common.getSessionId(event);
        try {
            let response = await dynamo.send(new common.GetCommand({ TableName: process.env.LimitTableName, Key: { tenantId, key: tenantId } }));
            if (response && response.Item && response.Item.itemCount && response.Item.itemCount >= event.requestContext.authorizer.tenantConnections) {
                console.log("Tenant " + tenantId + " over tenant total limit");
                return { statusCode: 429 };
            }

            response = await dynamo.send(new common.GetCommand({ TableName: process.env.SessionTableName, Key: { tenantId, sessionId } }));
            if (response && response.Item && response.Item.connectionIds && response.Item.connectionIds.size >= event.requestContext.authorizer.connectionsPerSession) {
                console.log("Tenant: " + tenantId + " Session: " + sessionId + " over session total limit");
                return { statusCode: 429 };
            }

            let updateResponse = await common.incrementLimitTablePerMinute(dynamo, tenantId, tenantId, "minute");
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.tenantPerMinute) {
                console.log("Tenant: " + tenantId + " over limit per minute");
                return { statusCode: 429 };
            }

            updateResponse = await common.incrementLimitTablePerMinute(dynamo, tenantId, tenantId + ":" + sessionId, "minute");
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.sessionPerMinute) {
                console.log(tenantId + "-" + sessionId + " over session per minute limit");
                return { statusCode: 429 };
            }

            await dynamo.send(new common.TransactWriteCommand({ TransactItems: [
                { Update: {
                    TableName: process.env.SessionTableName,
                    Key: { tenantId, sessionId },
                    UpdateExpression: "set sessionTTL = :ttl ADD connectionIds :c",
                    ExpressionAttributeValues: {
                        ":ttl": (Math.floor(+new Date() / 1000) + parseInt(event.requestContext.authorizer.sessionTTL)),
                        ":c": new Set([event.requestContext.connectionId])
                    }
                }},
                { Update: {
                    TableName: process.env.LimitTableName,
                    Key: { tenantId, key: tenantId },
                    UpdateExpression: "set itemCount = if_not_exists(itemCount, :zero) + :inc",
                    ExpressionAttributeValues: { ":inc": 1, ":zero": 0 }
                }}
            ]}));
        }
        catch (err) {
            console.error(err);
            return { statusCode: 1011 };
        }
        return { statusCode: 200 };
    }
    return { statusCode: 200 };
};
