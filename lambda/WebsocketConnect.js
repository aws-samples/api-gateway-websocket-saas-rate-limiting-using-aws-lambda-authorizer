// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.requestContext.routeKey == '$connect') {
        let dynamo = common.createDynamoDBClient(event);
        let tenantId = common.getTenantId(event);
        let sessionId = common.getSessionId(event);
        try {
            // Check if we are over the number of connections allowed per tenant
            let response = await dynamo.get({ "TableName": process.env.LimitTableName, "Key": { key: tenantId } }).promise();
            if (response && response.Item && response.Item.itemCount && response.Item.itemCount >= event.requestContext.authorizer.tenantConnections) {
                console.log("Tenant " + tenantId + " over tenant total limit");
                return { statusCode: 429 };
            }

            // Check if we are over the number of connections allowed per tenant session
            response = await dynamo.get({ "TableName": process.env.SessionTableName, "Key": { tenantId: tenantId, sessionId: sessionId } }).promise();
            if (response && response.Item && response.Item.connectionIds && response.Item.connectionIds.values.length >= event.requestContext.authorizer.connectionsPerSession) {
                console.log("Tenant: " + tenantId + " Session: " + sessionId + " over session total limit");
                return { statusCode: 429 };
            }

            // Update and check the total number of connections per minute per tenant
            var epoch = common.seconds_since_epoch();
            let currentMin = (Math.trunc(epoch / common.secondsPerMinute) * common.secondsPerMinute);
            let key = tenantId + ":minute:" + currentMin;
            var updateParams = {
                "TableName": process.env.LimitTableName,
                "Key": { key: key },
                "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
                "ExpressionAttributeValues": { ":ttl": currentMin + common.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
                "ReturnValues": "UPDATED_NEW"
            };
            let updateResponse = await dynamo.update(updateParams).promise();
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.tenantPerMinute) {
                console.log("Tenant: " + tenantId + " over limit per minute");
                return { statusCode: 429 };
            }

            // Update and check the total number of connections per minute per tenant/session
            key = tenantId + ":" + sessionId + ":minute:" + currentMin;
            updateParams = {
                "TableName": process.env.LimitTableName,
                "Key": { key: key },
                "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
                "ExpressionAttributeValues": { ":ttl": currentMin + common.secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
                "ReturnValues": "UPDATED_NEW"
            };
            updateResponse = await dynamo.update(updateParams).promise();
            if (!updateResponse || updateResponse.Attributes.itemCount > event.requestContext.authorizer.sessionPerMinute) {
                console.log(tenantId + "-" + sessionId + " over session per minute limit");
                return { statusCode: 429 };
            }

            // Update the session and limit table with the current connection Ids and counts now that we have passed all other checks
            var updateConnectIdParams = {
                "TableName": process.env.SessionTableName,
                "Key": { tenantId: tenantId, sessionId: sessionId },
                "UpdateExpression": "set sessionTTL = :ttl ADD connectionIds :c",
                "ExpressionAttributeValues": {
                    ":ttl": (Math.floor(+new Date() / 1000) + event.requestContext.authorizer.sessionTTL),
                    ":c": dynamo.createSet([event.requestContext.connectionId])
                },
                "ReturnValues": "NONE"
            };
            var updateConnectCountParams = {
                "TableName": process.env.LimitTableName,
                "Key": { key: tenantId },
                "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc",
                "ExpressionAttributeValues": { ":inc": 1, ":zero": 0 },
                "ReturnValues": "NONE"
            };
            await dynamo.transactWrite({ TransactItems: [ { Update: updateConnectIdParams }, { Update: updateConnectCountParams } ] }).promise();
        }
        catch (err) {
            console.log("Error: " + JSON.stringify(err));
            return { statusCode: 1011 }; // return server error code
        }
        return { statusCode: 200 };
    }

    return { statusCode: 200 };
};