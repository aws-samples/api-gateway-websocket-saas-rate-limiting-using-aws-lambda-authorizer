const tenant = require("./Tenant.js");
function seconds_since_epoch() { return Math.floor(Date.now() / 1000) }
const secondsPerMinute = 60;
let tenantSettingsCache = {}; // Defined outside the function globally

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    let dynamo = tenant.createDynamoDBClient(event);
    let tenantId = tenant.getTenantId(event);
    let sessionId = tenant.getSessionId(event);
    try {
        let response;
        if (tenantId in tenantSettingsCache) {
            response = tenantSettingsCache[tenantId];
        } else {
            response = await dynamo.get({ "TableName": process.env.TenantTableName, "Key": { tenantId: tenantId } }).promise();
            if (!response || !response.Item || !response.Item.tenantId) {
                console.log(tenantId + " tenant not found");
                return tenant.generateDeny(event.methodArn, event);
            }
            tenantSettingsCache[tenantId] = response;
        }
        let tenantPerMinute = response.Item.tenantPerMinute;
        let sessionPerMinute = response.Item.sessionPerMinute;
        let connectionsPerSession = response.Item.connectionsPerSession;
        let tenantConnections = response.Item.tenantConnections;

        // Check if we are over the number of connections allow per tenant
        response = await dynamo.get({ "TableName": process.env.LimitTableName, "Key": { key: tenantId } }).promise();
        if (response && response.Item && response.Item.itemCount && response.Item.itemCount >= tenantConnections) {
            console.log("Tenant " + tenantId + " not found or over tenant total limit");
            return tenant.generateDeny(event.methodArn, event);
        }

        // Check if we are over the number of connections allowed per tenant/session
        response = await dynamo.get({ "TableName": process.env.SessionTableName, "Key": { tenantId: tenantId, sessionId: sessionId } }).promise();
        if (response && response.Item && response.Item.connectionIds && response.Item.connectionIds.values.length >= connectionsPerSession) {
            console.log("Tenant:Session " + tenantId + "-" + sessionId + " not found or over session total limit");
            return tenant.generateDeny(event.methodArn, event);
        }

        // Update and check the total number of connections per minute per tenant
        var epoch = seconds_since_epoch();
        let currentMin = (Math.trunc(epoch / secondsPerMinute) * secondsPerMinute);
        let key = tenantId + ":minute:" + currentMin;
        var updateParams = {
            "TableName": process.env.LimitTableName,
            "Key": { key: key },
            "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
            "ExpressionAttributeValues": { ":ttl": currentMin + secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
            "ReturnValues": "UPDATED_NEW"
        };
        let updateResponse = await dynamo.update(updateParams).promise();
        if (!updateResponse || updateResponse.Attributes.itemCount > tenantPerMinute) {
            console.log("Tenant: " + tenantId + " over limit per minute");
            return tenant.generateDeny(event.methodArn, event);
        }

        // Update and check the total number of connections per minute per tenant/session
        key = tenantId + ":" + sessionId + ":minute:" + currentMin;
        updateParams = {
            "TableName": process.env.LimitTableName,
            "Key": { key: key },
            "UpdateExpression": "set itemCount = if_not_exists(itemCount, :zero) + :inc, itemTTL = :ttl",
            "ExpressionAttributeValues": { ":ttl": currentMin + secondsPerMinute + 1, ":inc": 1, ":zero": 0 },
            "ReturnValues": "UPDATED_NEW"
        };
        updateResponse = await dynamo.update(updateParams).promise();
        if (!updateResponse || updateResponse.Attributes.itemCount > sessionPerMinute) {
            console.log(tenantId + "-" + sessionId + " over session per minute limit");
            return tenant.generateDeny(event.methodArn, event);
        }
        return tenant.generateAllow(event.methodArn, event);
    }
    catch (err) {
        console.log("Error: " + JSON.stringify(err));
        return tenant.generateDeny(event.methodArn, event);
    }
}


