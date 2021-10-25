// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

// This handler will remove the current connection from the sessions connectionId set
// and decrement the total number of connections for this tenant
exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.requestContext.routeKey == '$disconnect') {
        try {
            let dynamo = common.createDynamoDBClient(event);
            let tenantId = common.getTenantId(event);
            let sessionId = common.getSessionId(event);
            let deleteConnectIdParams = {
                "TableName": process.env.SessionTableName,
                "Key": {tenantId: tenantId, sessionId: sessionId},
                "UpdateExpression": "DELETE connectionIds :c",
                "ExpressionAttributeValues": {
                    ":c": dynamo.createSet([event.requestContext.connectionId])
                },
                "ReturnValues": "NONE"
            };
            let updateConnectCountParams = {
                "TableName": process.env.LimitTableName,
                "Key": {key: tenantId},
                "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) - :dec",
                "ExpressionAttributeValues": {":dec": 1, ":zero": 0},
                "ReturnValues": "NONE"
            };
            await dynamo.transactWrite({TransactItems: [{Update: deleteConnectIdParams}, {Update: updateConnectCountParams}]}).promise();
        } catch (err) {
            console.error(err);
            return {statusCode: 1011}; // return server error code
        }
    }
    return { statusCode: 200 };
}
