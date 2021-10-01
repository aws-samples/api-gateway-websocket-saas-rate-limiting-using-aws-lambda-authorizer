const tenant = require("./Tenant.js");
const TTL = 60 * 5; // Set TTL for 5 mins

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    if (event.requestContext.routeKey == '$connect') {
        let dynamo = tenant.createDynamoDBClient(event);
        let tenantId = tenant.getTenantId(event);
        let sessionId = tenant.getSessionId(event);
        try {
            var updateConnectIdParams = {
                "TableName": process.env.SessionTableName,
                "Key": { tenantId: tenantId, sessionId: sessionId },
                "UpdateExpression": "set sessionTTL = :ttl ADD connectionIds :c",
                "ExpressionAttributeValues": {
                    ":ttl": (Math.floor(+new Date() / 1000) + TTL),
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
