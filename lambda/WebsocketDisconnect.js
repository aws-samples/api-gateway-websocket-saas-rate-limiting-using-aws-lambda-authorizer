// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.requestContext.routeKey == '$disconnect') {
        let dynamo = common.createDynamoDBClient(event);
        let tenantId = common.getTenantId(event);
        let sessionId = common.getSessionId(event);
        var deleteConnectIdParams = {
            "TableName": process.env.SessionTableName,
            "Key": { tenantId: tenantId, sessionId: sessionId },
            "UpdateExpression": "DELETE connectionIds :c",
            "ExpressionAttributeValues": {
                ":c": dynamo.createSet([event.requestContext.connectionId])
            },
            "ReturnValues": "NONE"
        };
        var updateConnectCountParams = {
            "TableName": process.env.LimitTableName,
            "Key": { key: tenantId },
            "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) - :dec",
            "ExpressionAttributeValues": { ":dec": 1, ":zero": 0 },
            "ReturnValues": "NONE"
        };
        await dynamo.transactWrite({ TransactItems: [ { Update: deleteConnectIdParams }, { Update: updateConnectCountParams } ] }).promise();
    }

    return { statusCode: 200 };
};
