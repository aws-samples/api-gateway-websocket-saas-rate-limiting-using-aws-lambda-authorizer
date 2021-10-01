const tenant = require("./Tenant.js");

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.requestContext.routeKey == '$disconnect') {
        let dynamo = tenant.createDynamoDBClient(event);
        let tenantId = tenant.getTenantId(event);
        let sessionId = tenant.getSessionId(event);
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
